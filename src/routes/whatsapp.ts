import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { reiniciarWhatsapp } from "../services/whatsappServices.js";

const router = express.Router();

/**
 * POST /api/whatsapp/reiniciar
 * Botón "Reiniciar vínculo" del dashboard: fuerza cerrar la sesión actual de
 * WhatsApp y generar un QR nuevo, sin depender de un redeploy. Útil cuando el
 * bot queda en un estado raro (ej. aparece "listo" pero no responde, o quedó
 * un vínculo a medias de una prueba anterior).
 */
router.post("/whatsapp/reiniciar", authenticateToken, async (_req, res) => {
  try {
    // No se espera a que termine (puede tardar unos segundos en reconectar);
    // el dashboard se entera del resultado por los eventos whatsapp_qr/whatsapp_ready.
    reiniciarWhatsapp().catch((e) => console.error("Error reiniciando WhatsApp:", e));
    return res.json({ ok: true });
  } catch (error) {
    console.error("Error al pedir el reinicio de WhatsApp:", error);
    return res.status(500).json({ ok: false, error: "No se pudo reiniciar el vínculo" });
  }
});

export default router;
