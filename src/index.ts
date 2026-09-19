import "dotenv/config";
import express from "express";
import http from "http";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { sequelize } from "./config/db.js";
import { initSocket } from "./config/socket.js";
import authRoutes from "./routes/auth.js";
import pedidosRoutes from "./routes/pedidos.js";
import clientesRoutes from "./routes/clientes.js";
import whatsappRoutes from "./routes/whatsapp.js";
import whatsappWebhookRoutes from "./routes/whatsappWebhook.js";
import configuracionRoutes from "./routes/configuracion.js";
import { iniciarWhatsapp } from "./services/whatsappServices.js";

// Red de seguridad: cualquier promesa rechazada sin `.catch` en algún punto
// del código (ej. el handler de mensajes de Baileys) mataría el proceso
// completo por defecto desde Node 15 — tumbando el bot para todos los
// clientes por un error de uno solo. Esto no reemplaza atrapar errores donde
// corresponde, solo evita que un olvido puntual se lleve todo el servidor.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] Promesa rechazada sin atrapar:", reason);
});

// Variables obligatorias en producción: sin ellas el server no debe arrancar
// con fallbacks inseguros conocidos (ver src/routes/auth.ts).
if (process.env.NODE_ENV === "production") {
  const requeridas = ["JWT_SECRET", "DASHBOARD_USER", "DASHBOARD_PASSWORD"];
  const faltantes = requeridas.filter((k) => !process.env[k]);
  if (faltantes.length > 0) {
    console.error(`Faltan variables de entorno obligatorias en producción: ${faltantes.join(", ")}`);
    process.exit(1);
  }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Render (y Cloudflare delante) proxean las peticiones agregando X-Forwarded-For.
// Sin esto, express-rate-limit rechaza esa cabecera como sospechosa en cada request
// (podría ser IP spoofing de un cliente directo) y tira ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
// "2" = confía en dos saltos de proxy (Cloudflare + Render). Con "1" (el valor
// anterior), Express solo descontaba un salto de X-Forwarded-For y terminaba
// resolviendo req.ip a la IP de borde de Cloudflare para TODO el tráfico — el
// rate limiter (login incluido) trataba a todos los usuarios como una sola IP,
// pudiendo bloquear al admin real por el tráfico de otra persona.
app.set("trust proxy", 2);

// ===================== SEGURIDAD PRODUCCIÓN =====================

// 1. Helmet - cabeceras seguras (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet());

// 2. CORS restringido por variable de entorno
// .env => ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://tudominio.com
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173", "http://localhost:5500"];

// "*" en ALLOWED_ORIGINS ya NO se trata como "permitir cualquier origen": con
// credentials:true (abajo) eso reflejaba el Origin real de CUALQUIER sitio en
// Access-Control-Allow-Origin, dejando que una página maliciosa hiciera
// peticiones autenticadas contra esta API desde el navegador de un admin
// logueado. Si de verdad se necesita abrir la API a cualquier origen, hay que
// hacerlo explícitamente sin `credentials`, no colando "*" en esta lista.
if (allowedOrigins.includes("*")) {
  console.warn(
    '[CORS] ALLOWED_ORIGINS incluye "*" — se ignora por seguridad (credentials:true no debe combinarse con origen comodín). Lista los orígenes exactos permitidos.'
  );
}

app.use(
  cors({
    origin: function (origin, callback) {
      // origin === undefined -> peticiones sin origen (curl, postman, server-to-server) -> permitir
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS bloqueado para origen: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// 3. Rate Limit Global - evita DDoS / scraping masivo
// /ping queda exento: Render lo golpea seguido como healthcheck, y si se le acaba
// el cupo, Render cree que el servicio está caído y lo reinicia solo (matando la
// sesión de WhatsApp en el proceso). Un healthcheck nunca debería competir por cupo
// con tráfico real.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por IP cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  // /ping: ver arriba. /whatsapp/webhook: Meta reintenta agresivo si no hay ack
  // rápido, y el "cliente" real acá es Meta, no un visitante — limitar por IP no
  // tiene sentido para tráfico ya autenticado por firma HMAC (ver whatsappWebhook.ts).
  skip: (req) => req.path === "/ping" || req.path === "/api/whatsapp/webhook",
  message: { ok: false, error: "Demasiadas peticiones. Intenta más tarde." },
});
app.use(globalLimiter);

// ===================== RUTAS =====================

// Webhook de WhatsApp Cloud API (ver plan de migración de Baileys a Cloud API):
// se monta ANTES de express.json() a propósito — necesita el body crudo para
// verificar la firma HMAC de Meta (X-Hub-Signature-256), y su propia ruta ya
// trae su propio express.raw() en whatsappWebhook.ts. Si se montara después de
// express.json(), el body ya vendría parseado/consumido y la firma nunca
// calzaría. No usa auth JWT (Meta llama esta ruta directo, no un usuario del
// dashboard) — la autenticidad se valida por firma, no por token.
app.use("/api", whatsappWebhookRoutes);

// 4. Parsers
app.use(express.json({ limit: "100kb" })); // limita tamaño body
app.use(express.urlencoded({ extended: true }));

// Ruta health check (sin auth)
app.get("/ping", (_req, res) => {
  res.json({ mensaje: "El bot está funcionando", ok: true });
});

// Ruta de autenticación
app.use("/api", authRoutes);
app.use("/api", pedidosRoutes);
app.use("/api", clientesRoutes);
app.use("/api", whatsappRoutes);
app.use("/api", configuracionRoutes);

// ===================== SERVIDOR HTTP + SOCKET.IO =====================

const server = http.createServer(app);

// Inicializa Socket.IO + middleware JWT (ver src/config/socket.ts)
const io = initSocket(server);

// ===================== ARRANQUE =====================

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`Servidor corriendo en http://localhost:${PORT} y http://192.168.1.6:${PORT}`);
  console.log(`CORS permitido para: ${allowedOrigins.join(", ")}`);

  // Transporte de WhatsApp (ver plan de migración de Baileys a Cloud API):
  // "baileys" (default, hoy) inicia la sesión no oficial de WhatsApp Web;
  // "cloud" usa la API oficial vía el webhook de arriba y no necesita ninguna
  // conexión persistente que iniciar acá. Los dos conviven en el código a
  // propósito durante la migración, pero nunca deben estar ACTIVOS los dos a
  // la vez (se respondería duplicado a cada cliente).
  if ((process.env.WHATSAPP_TRANSPORT || "baileys") === "baileys") {
    // Async: se maneja con .catch, no con try/catch, porque el error puede
    // llegar en una promesa rechazada más adelante, no al llamar.
    iniciarWhatsapp().catch((e) => console.error("Error inicializando WhatsApp:", e));
  } else {
    console.log("[WhatsApp] Transporte Cloud API activo — esperando webhooks en /api/whatsapp/webhook.");
  }

  try {
    await sequelize.authenticate();
    console.log("Conexión con PG establecida correctamente.");
  } catch (error) {
    console.error("No se pudo conectar a la DB:", (error as Error).message);
  }
});

// Manejo de errores CORS para respuesta JSON limpia
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.message && err.message.startsWith("CORS")) {
    return res.status(403).json({ ok: false, error: err.message });
  }
  return next(err);
});

// Exportar io/app/server para usar en otros archivos SI LO REQUIEREN directamente desde index
// Nota: preferible usar `import { getIO } from "./config/socket.js"` para evitar dependencias circulares.
// Pero se exporta igual para cumplir el entregable: "el servidor debe exportar la instancia de io"
export { app, server, io };
