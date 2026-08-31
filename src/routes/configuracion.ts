import express from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth.js";
import { ConfiguracionBot, CONFIGURACION_BOT_ID } from "../config/db.js";
import { actualizarConfiguracionBotCache } from "../services/whatsappServices.js";

const router = express.Router();

/**
 * GET /api/configuracion
 * Estado actual del botón de pausa del bot. Existe para que el dashboard lo
 * recupere al recargar la página, igual que el resto de estado persistido.
 */
router.get("/configuracion", authenticateToken, async (_req, res) => {
  try {
    const [fila] = await ConfiguracionBot.findOrCreate({
      where: { id: CONFIGURACION_BOT_ID },
      defaults: { id: CONFIGURACION_BOT_ID },
    });
    return res.json({
      ok: true,
      activo: fila.activo,
      mensajePausa: fila.mensajePausa,
      duracionFranjaMin: fila.duracionFranjaMin,
      capacidadPorFranja: fila.capacidadPorFranja,
      notificacionesWhatsappActivas: fila.notificacionesWhatsappActivas,
      numeroNotificaciones: fila.numeroNotificaciones,
    });
  } catch (error) {
    console.error("Error al leer la configuración del bot:", error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar la configuración" });
  }
});

const configuracionSchema = z.object({
  activo: z.boolean().optional(),
  mensajePausa: z.string().min(1).optional(),
  //Franjas de agenda fuera de horario (ver ADR-002). Valores temporales hasta
  //que la dueña confirme cuántos pedidos puede tener listos en paralelo.
  duracionFranjaMin: z.number().int().positive().optional(),
  capacidadPorFranja: z.number().int().positive().optional(),
  //Aviso adicional por WhatsApp al número de turno (parche para cuando el sonido
  //del dashboard no es confiable con el celular bloqueado, ver whatsappServices.ts).
  notificacionesWhatsappActivas: z.boolean().optional(),
  numeroNotificaciones: z.string().trim().regex(/^\d*$/, "Solo dígitos, sin +, espacios ni guiones").optional().nullable(),
});

/**
 * PATCH /api/configuracion
 * Botón de pausa/emergencia: corta las respuestas automáticas del bot sin tocar
 * código ni redeploy. También permite editar el mensaje que se manda mientras
 * está pausado.
 */
router.patch("/configuracion", authenticateToken, async (req, res) => {
  const parsed = configuracionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Datos inválidos", details: parsed.error.flatten() });
  }

  // Un campo de texto vacío en el dashboard significa "sin número configurado",
  // no un string vacío literal — se guarda como null para que quede consistente
  // con el resto del código (que trata "sin número" como null/falsy).
  const datos = {
    ...parsed.data,
    ...(parsed.data.numeroNotificaciones !== undefined
      ? { numeroNotificaciones: parsed.data.numeroNotificaciones || null }
      : {}),
  };

  try {
    const [fila] = await ConfiguracionBot.findOrCreate({
      where: { id: CONFIGURACION_BOT_ID },
      defaults: { id: CONFIGURACION_BOT_ID },
    });
    await fila.update(datos);
    actualizarConfiguracionBotCache(datos);

    try {
      const { getIO } = await import("../config/socket.js");
      getIO().emit("bot_estado", { activo: fila.activo, mensajePausa: fila.mensajePausa });
    } catch (e) {
      console.warn("[Socket.IO] No se pudo emitir bot_estado:", e instanceof Error ? e.message : e);
    }

    return res.json({
      ok: true,
      activo: fila.activo,
      mensajePausa: fila.mensajePausa,
      duracionFranjaMin: fila.duracionFranjaMin,
      capacidadPorFranja: fila.capacidadPorFranja,
      notificacionesWhatsappActivas: fila.notificacionesWhatsappActivas,
      numeroNotificaciones: fila.numeroNotificaciones,
    });
  } catch (error) {
    console.error("Error al actualizar la configuración del bot:", error);
    return res.status(500).json({ ok: false, error: "No se pudo actualizar la configuración" });
  }
});

export default router;
