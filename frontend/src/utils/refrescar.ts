// Aviso entre hooks del dashboard: "hay que volver a pedir los pedidos activos".
// Lo usa usePedidosProgramados cuando llega la hora de un pedido agendado (en ese
// instante el pedido pasa de "programados" a "activos" en el backend, y no hay
// ningún evento de socket que lo anuncie).
export const EVENTO_REFRESCAR_PEDIDOS = 'urbanperu:refrescar-pedidos'

export function pedirRefrescoDePedidos() {
  window.dispatchEvent(new Event(EVENTO_REFRESCAR_PEDIDOS))
}
