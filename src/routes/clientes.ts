import express from "express";
import { Op } from "sequelize";
import { authenticateToken } from "../middleware/auth.js";
import { Cliente } from "../config/db.js";
import { reanudarBot } from "../services/whatsappServices.js";

const router = express.Router();

/**
 * GET /api/clientes/necesitan-humano
 * Clientes que pidieron hablar con una persona y todavía no fueron devueltos al bot.
 * Existe para que el Dashboard los siga mostrando tras recargar la página, igual
 * que GET /api/pedidos con los pedidos activos.
 */
router.get("/clientes/necesitan-humano", authenticateToken, async (_req, res) => {
  try {
    const clientes = await Cliente.findAll({
      where: { necesitaHumanoDesde: { [Op.ne]: null } },
      order: [["necesitaHumanoDesde", "ASC"]],
    });

    const data = clientes.map((c) => ({
      telefono: c.telefono,
      nombre: c.nombre,
      desde: c.necesitaHumanoDesde?.toISOString(),
    }));

    return res.json({ ok: true, clientes: data });
  } catch (error) {
    console.error("Error al listar clientes que necesitan humano:", error);
    return res.status(500).json({ ok: false, error: "No se pudo cargar la lista" });
  }
});

/**
 * PATCH /api/clientes/:telefono/reanudar-bot
 * El equipo terminó de atender manualmente por WhatsApp y quiere que el bot
 * vuelva a responderle a ese número.
 */
router.patch("/clientes/:telefono/reanudar-bot", authenticateToken, async (req, res) => {
  const telefono = String(req.params.telefono);

  await Cliente.update({ necesitaHumanoDesde: null }, { where: { telefono } });
  reanudarBot(telefono);

  try {
    const { getIO } = await import("../config/socket.js");
    getIO().emit("cliente_bot_reanudado", { telefono });
  } catch (e) {
    console.warn("[Socket.IO] No se pudo emitir cliente_bot_reanudado:", e instanceof Error ? e.message : e);
  }

  return res.json({ ok: true });
});

export default router;
