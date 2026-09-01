import express from "express";
import { z } from "zod";
import { Op } from "sequelize";
import { authenticateToken } from "../middleware/auth.js";
import { Pedido, Cliente, DetallePedido, Producto } from "../config/db.js";

const router = express.Router();

//Estados que ya no se muestran en el dashboard (turno terminado para ese pedido).
const ESTADOS_CERRADOS = ["entregado", "cancelado"] as const;
const ESTADOS_VALIDOS = ["comprando", "pendiente", "preparando", "listo", "entregado", "cancelado"] as const;
const ESTADOS_ACTIVOS = ESTADOS_VALIDOS.filter((e) => !ESTADOS_CERRADOS.includes(e as never));

//Historial de no-shows por cliente (cuántos pedidos anteriores quedaron
//"cancelado"), para que el equipo lo vea antes de empezar a cocinar. Se agrupa
//por cliente para no repetir la misma consulta varias veces.
async function calcularNoShowsPorCliente(pedidos: Pedido[]): Promise<Map<string, number>> {
  const clienteIds = [...new Set(pedidos.map((p) => p.cliente_id))];
  const noShowsPorCliente = new Map<string, number>();
  await Promise.all(
    clienteIds.map(async (id) => {
      noShowsPorCliente.set(id, await Pedido.count({ where: { cliente_id: id, estado: "cancelado" } }));
    })
  );
  return noShowsPorCliente;
}

function mapearPedido(p: Pedido, clienteNoShows: number) {
  return {
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
    clienteNoShows,
    modalidad: p.modalidad ?? null,
    direccion: p.direccion ?? null,
    montoRecibido: p.montoRecibido ?? null,
    vuelto: p.montoRecibido != null ? p.montoRecibido - p.total : null,
    tiempoEstimadoMin: p.tiempoEstimadoMin ?? null,
    tiempoEstimadoMax: p.tiempoEstimadoMax ?? null,
    horaProgramada: p.horaProgramada ? p.horaProgramada.toISOString() : null,
    fecha: p.createdAt.toISOString(),
  };
}

/**
 * GET /api/pedidos
 * Pedidos activos (no entregados/cancelados), más recientes primero.
 * Existe para que el Dashboard recupere lo que haya quedado pendiente al recargar
 * la página (ej. el celular descarga la pestaña en segundo plano) en vez de
 * depender solo del evento en vivo de Socket.IO, que se pierde si no estaba
 * conectado en el momento exacto del pedido.
 *
 * Los pedidos agendados (horaProgramada) que todavía no llegan a su hora se
 * excluyen de acá — viven en GET /api/pedidos/programados hasta que corresponda,
 * para que la cocina no los mezcle con lo urgente antes de tiempo (ver ADR-002).
 */
router.get("/pedidos", authenticateToken, async (_req, res) => {
  try {
    const pedidos = await Pedido.findAll({
      where: {
        estado: ESTADOS_ACTIVOS,
        [Op.or]: [{ horaProgramada: null }, { horaProgramada: { [Op.lte]: new Date() } }],
      },
      order: [["createdAt", "DESC"]],
      include: [
        { model: Cliente },
        { model: DetallePedido, include: [{ model: Producto }] },
      ],
    });

    const noShowsPorCliente = await calcularNoShowsPorCliente(pedidos);
    const data = pedidos.map((p) => mapearPedido(p, noShowsPorCliente.get(p.cliente_id) ?? 0));

    return res.json({ ok: true, pedidos: data });
  } catch (error) {
    console.error("Error al listar pedidos:", error);
    return res.status(500).json({ ok: false, error: "No se pudieron cargar los pedidos" });
  }
});

/**
 * GET /api/pedidos/programados
 * Pedidos agendados fuera de horario (ver ADR-002) cuya hora todavía no llega —
 * sección separada del dashboard, para no mezclarlos con lo urgente de ahora.
 * Ordenados por hora comprometida, no por fecha de creación.
 *
 * En cuanto la hora comprometida llega, el pedido debe pasar a GET /api/pedidos
 * (con el botón "Listo") y desaparecer de acá — por eso el mismo corte
 * "horaProgramada > ahora" que usa GET /api/pedidos, en espejo.
 */
router.get("/pedidos/programados", authenticateToken, async (_req, res) => {
  try {
    const pedidos = await Pedido.findAll({
      where: { estado: ESTADOS_ACTIVOS, horaProgramada: { [Op.gt]: new Date() } },
      order: [["horaProgramada", "ASC"]],
      include: [
        { model: Cliente },
        { model: DetallePedido, include: [{ model: Producto }] },
      ],
    });

    const noShowsPorCliente = await calcularNoShowsPorCliente(pedidos);
    const data = pedidos.map((p) => mapearPedido(p, noShowsPorCliente.get(p.cliente_id) ?? 0));

    return res.json({ ok: true, pedidos: data });
  } catch (error) {
    console.error("Error al listar pedidos programados:", error);
    return res.status(500).json({ ok: false, error: "No se pudieron cargar los pedidos programados" });
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
