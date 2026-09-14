import express from "express";
import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { manejarMensajeEntrante, getConfiguracionBot, estaEsperandoComprobante } from "../services/whatsappServices.js";
import { enviarTexto, enviarImagenBuffer, enviarPlantilla, descargarMedia } from "../services/whatsappCloudApi.js";

//Webhook de WhatsApp Business Platform (Cloud API) — ver plan de migración de
//Baileys a Cloud API. Meta llama esta ruta directo (sin JWT: no es un usuario de
//nuestro dashboard), así que la autenticidad se valida con la firma HMAC del
//body, no con el middleware de auth de las demás rutas.
//
//OJO al montar esta ruta en src/index.ts: necesita el body CRUDO para calcular
//la firma, así que su parser (express.raw, abajo) tiene que ejecutarse ANTES
//que el express.json() global — o esta ruta nunca ve el body sin parsear.
const router = express.Router();

//Imagen de datos bancarios: mismo archivo que usa Baileys hoy (ver
//RUTA_DATOS_BANCARIOS en whatsappServices.ts). Se resuelve acá porque
//enviarDatosBancarios necesita el buffer, no la ruta.
const RUTA_DATOS_BANCARIOS = path.join(process.cwd(), "assets", "datos-transferencia.jpg");
let datosBancariosBuffer: Buffer | null = null;
if (existsSync(RUTA_DATOS_BANCARIOS)) {
  datosBancariosBuffer = readFileSync(RUTA_DATOS_BANCARIOS);
}

//Nombre de la plantilla utility aprobada en Meta Business Manager para avisar
//al staff (ver Fase B del plan: notificarStaff no puede mandar texto libre
//porque el staff nunca le escribe primero al bot, así que no hay ventana de
//24h abierta). Configurable por si el nombre real difiere al aprobado.
const NOMBRE_PLANTILLA_AVISO_STAFF = process.env.WHATSAPP_TEMPLATE_AVISO_STAFF || "nuevo_pedido_alerta";

//Dedup por message.id: Meta puede reentregar el mismo mensaje si el ack tarda
//(mismo motivo que el Set equivalente para Baileys en whatsappServices.ts).
const mensajesProcesados = new Set<string>();
const MAX_MENSAJES_PROCESADOS = 1000;
function yaProcesado(id: string): boolean {
  if (mensajesProcesados.has(id)) return true;
  mensajesProcesados.add(id);
  if (mensajesProcesados.size > MAX_MENSAJES_PROCESADOS) {
    const masAntiguo = mensajesProcesados.values().next().value;
    if (masAntiguo) mensajesProcesados.delete(masAntiguo);
  }
  return false;
}

/**
 * GET /api/whatsapp/webhook
 * Handshake de verificación de Meta al configurar el webhook en el dashboard
 * de desarrolladores: si el verify_token coincide, hay que devolver el
 * challenge tal cual para confirmar que la URL es nuestra.
 */
router.get("/whatsapp/webhook", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[WhatsApp Cloud API] Verificación de webhook OK.");
    return res.status(200).send(challenge);
  }
  console.warn(`[WhatsApp Cloud API] Verificación de webhook FALLÓ — modo="${modo}", token recibido="${token}"`);
  return res.sendStatus(403);
});

/**
 * POST /api/whatsapp/webhook
 * Body: payload de Meta (mensajes entrantes, o recibos de estado que se ignoran).
 * Necesita el body crudo (express.raw) para poder verificar X-Hub-Signature-256.
 */
router.post("/whatsapp/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body as Buffer;

  if (!verificarFirma(rawBody, req.header("x-hub-signature-256"))) {
    console.warn("[WhatsApp Cloud API] Firma de webhook inválida, ignorado.");
    return res.sendStatus(403);
  }

  //Meta exige un ack rápido (<20s) o reintenta y puede llegar a desactivar el
  //webhook — se responde ANTES de procesar, igual que el patrón fire-and-forget
  //ya usado para los mensajes de Baileys.
  res.sendStatus(200);

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (e) {
    console.error("[WhatsApp Cloud API] Body del webhook no es JSON válido:", e);
    return;
  }

  void procesarWebhook(payload).catch((e) => {
    console.error("[WhatsApp Cloud API] Error procesando webhook:", e);
  });
  return;
});

function verificarFirma(rawBody: Buffer, firmaHeader: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !firmaHeader) return false;

  const esperada = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const recibida = Buffer.from(firmaHeader);
  const esperadaBuf = Buffer.from(esperada);
  if (recibida.length !== esperadaBuf.length) return false;
  return crypto.timingSafeEqual(recibida, esperadaBuf);
}

async function procesarWebhook(payload: any): Promise<void> {
  const mensajes: any[] = payload?.entry?.flatMap((e: any) =>
    e?.changes?.flatMap((c: any) => c?.value?.messages ?? []) ?? []
  ) ?? [];

  for (const msg of mensajes) {
    if (!msg?.id || yaProcesado(msg.id)) continue;

    //Cloud API entrega el número real siempre en E.164 (sin el problema de LID
    //que tiene Baileys) — nada que resolver acá.
    const numeroTelefono: string = msg.from;
    if (!numeroTelefono) continue;

    const responder = (texto: string) => enviarTexto(numeroTelefono, texto);
    const notificarStaff = async (texto: string) => {
      const staff = getConfiguracionBot().numeroNotificaciones;
      if (!staff) return;
      try {
        await enviarPlantilla(staff, NOMBRE_PLANTILLA_AVISO_STAFF, [texto]);
      } catch (e) {
        console.warn("[WhatsApp Cloud API] No se pudo enviar el aviso de pedido nuevo al staff:", e);
      }
    };
    const enviarDatosBancarios = async () => {
      if (!datosBancariosBuffer) return;
      await enviarImagenBuffer(numeroTelefono, datosBancariosBuffer, "image/jpeg", "🏦 Estos son nuestros datos para la transferencia.");
    };

    //Solo vale la pena bajar la imagen (llamada extra a la Graph API) si
    //corresponde — cualquier otra imagen mandada en otro momento se ignora igual.
    let imagen: { buffer: Buffer; mimetype: string } | null = null;
    if (msg.type === "image" && msg.image?.id && estaEsperandoComprobante(numeroTelefono)) {
      try {
        const { buffer, mimeType } = await descargarMedia(msg.image.id);
        imagen = { buffer, mimetype: mimeType };
      } catch (e) {
        console.error("[WhatsApp Cloud API] Error descargando comprobante de transferencia:", e);
        await responder("❌ No pude leer esa imagen, ¿puedes volver a enviarla?");
        continue;
      }
    }

    const texto: string | undefined = msg.type === "text" ? msg.text?.body : undefined;

    await manejarMensajeEntrante({
      numeroTelefono,
      texto,
      imagen,
      responder,
      enviarDatosBancarios,
      notificarStaff,
    });
  }
}

export default router;
