import type { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { getUltimoQr } from "../services/whatsappServices.js";

/**
 * Singleton de Socket.IO para poder usarlo en cualquier archivo sin circular deps.
 * Uso:
 *   const { getIO } = require("../config/socket");
 *   getIO().emit("nuevo_pedido", pedido);
 *   getIO().to("dashboard").emit("nuevo_pedido", pedido);
 */

interface AuthedSocket extends Socket {
  user?: string | jwt.JwtPayload;
}

let io: Server | null = null;

function initSocket(httpServer: HttpServer): Server {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173", "http://localhost:5500"];

  io = new Server(httpServer, {
    cors: {
      origin: function (origin, callback) {
        // Permitir requests sin origin (ej. Postman, mobile, curl) solo si se desea
        // En producción estricto, puedes rechazar !origin.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
          return callback(null, true);
        }
        return callback(new Error(`CORS Socket.IO no permitido para origen: ${origin}`));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // --- Middleware JWT para Socket.IO ---
  // El frontend debe conectarse así:
  // io("http://localhost:3000", { auth: { token: "Bearer <JWT>" } })
  // o { auth: { token: "<JWT>" } }
  io.use((socket: AuthedSocket, next) => {
    try {
      const tokenRaw = socket.handshake.auth?.token || socket.handshake.headers?.authorization;

      if (!tokenRaw) {
        return next(new Error("No autorizado: token no proporcionado"));
      }

      // Soporta "Bearer xxx" o "xxx" directo
      const token = tokenRaw.startsWith("Bearer ") ? tokenRaw.slice(7) : tokenRaw;

      if (!process.env.JWT_SECRET) {
        console.error("[socketAuth] JWT_SECRET no definido en .env");
        return next(new Error("Error interno de autenticación"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { user: "admin", iat, exp }
      return next();
    } catch (err) {
      return next(new Error("No autorizado: token inválido o expirado"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    const user = typeof socket.user === "object" ? socket.user?.user : undefined;
    console.log(`[Socket.IO] Cliente autenticado conectado: ${socket.id} | user=${user}`);

    // Opcional: unir a room dashboard para broadcast segmentado
    socket.join("dashboard");

    // Si WhatsApp está esperando que lo escaneen, el evento "whatsapp_qr" ya pudo
    // haberse emitido antes de que este dashboard terminara de conectarse. Se lo
    // mandamos directo para que no se quede esperando el próximo QR (rota cada
    // ~20-60s hasta que alguien lo escanea).
    const qrPendiente = getUltimoQr();
    if (qrPendiente) {
      socket.emit("whatsapp_qr", { qr: qrPendiente });
    }

    socket.on("disconnect", (reason) => {
      console.log(`[Socket.IO] Desconectado ${socket.id}: ${reason}`);
    });
  });

  return io;
}

function getIO(): Server {
  if (!io) {
    throw new Error("Socket.IO no inicializado. Llama a initSocket(server) primero en src/index.ts");
  }
  return io;
}

export { initSocket, getIO };
