import express from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth.js";
import { Pedido, Cliente, DetallePedido, Producto } from "../config/db.js";

const router = express.Router();

//Estados que ya no se muestran en el dashboard (turno terminado para ese pedido).
const ESTADOS_CERRADOS = ["entregado", "cancelado"] as const;
const ESTADOS_VALIDOS = ["comprando", "pendiente", "preparando", "listo", "entregado", "cancelado"] as const;

/**
 * GET /api/pedidos
 * Pedidos activos (no entregados/cancelados), más recientes primero.
 * Existe para que el Dashboard recupere lo que haya quedado pendiente al recargar
 * la página (ej. el celular descarga la pestaña en segundo plano) en vez de
 * depender solo del evento en vivo de Socket.IO, que se pierde si no estaba
 * conectado en el momento exacto del pedido.
 */
router.get("/pedidos", authenticateToken, async (_req, res) => {
  try {
    const pedidos = await Pedido.findAll({
      where: { estado: ESTADOS_VALIDOS.filter((e) => !ESTADOS_CERRADOS.includes(e as never)) },
      order: [["createdAt", "DESC"]],
      include: [
        { model: Cliente },
        { model: DetallePedido, include: [{ model: Producto }] },
      ],
    });

    // Historial de no-shows por cliente (cuántos pedidos anteriores quedaron
    // "cancelado"), para que el equipo lo vea antes de empezar a cocinar. Se
    // agrupa por cliente para no repetir la misma consulta varias veces.
    const clienteIds = [...new Set(pedidos.map((p) => p.cliente_id))];
    const noShowsPorCliente = new Map<string, number>();
    await Promise.all(
      clienteIds.map(async (id) => {
        noShowsPorCliente.set(id, await Pedido.count({ where: { cliente_id: id, estado: "cancelado" } }));
      })
    );

    const data = pedidos.map((p) => ({
      id: p.id,
      cliente: {
        nombre: p.Cliente?.nombre ?? "Cliente",
        telefono: p.Cliente?.telefono ?? "",
        whatsapp: p.Cliente?.telefono ? `${p.Cliente.telefono}@s.whatsapp.net` : "",
      },
      items: (p.DetallePedidos ?? []).map((d) => ({
        nombre: d.Producto?.nombre ?? "Producto",
        precio: d.precio_unitario,
        cantidad: d.cantidad,
      })),
      total: p.total,
      resumen: p.notas ?? "",
      metodoPago: p.metodoPago ?? null,
      comprobanteImagen: p.comprobanteImagen ?? null,
      clienteNoShows: noShowsPorCliente.get(p.cliente_id) ?? 0,
      modalidad: p.modalidad ?? null,
      direccion: p.direccion ?? null,
      montoRecibido: p.montoRecibido ?? null,
      vuelto: p.montoRecibido != null ? p.montoRecibido - p.total : null,
      tiempoEstimadoMin: p.tiempoEstimadoMin ?? null,
      tiempoEstimadoMax: p.tiempoEstimadoMax ?? null,
      fecha: p.createdAt.toISOString(),
    }));

    return res.json({ ok: true, pedidos: data });
  } catch (error) {
    console.error("Error al listar pedidos:", error);
    return res.status(500).json({ ok: false, error: "No se pudieron cargar los pedidos" });
  }
});

const estadoSchema = z.object({
  estado: z.enum(ESTADOS_VALIDOS),
});

/**
 * PATCH /api/pedidos/:id
 * Body: { estado }
 * Usado por el botón "✓ Listo" del dashboard para marcar un pedido como
 * entregado; sin esto, el pedido reaparecería en cada recarga (GET /api/pedidos
 * solo excluye entregado/cancelado).
 */
router.patch("/pedidos/:id", authenticateToken, async (req, res) => {
  const parsed = estadoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Estado inválido", details: parsed.error.flatten() });
  }

  const pedido = await Pedido.findByPk(String(req.params.id));
  if (!pedido) {
    return res.status(404).json({ ok: false, error: "Pedido no encontrado" });
  }

  pedido.estado = parsed.data.estado;
  await pedido.save();

  return res.json({ ok: true });
});

export default router;
