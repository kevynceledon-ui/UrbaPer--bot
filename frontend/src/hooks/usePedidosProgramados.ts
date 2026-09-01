import { useCallback, useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type { Order } from '../types/order'
import { getSocket } from '../services/socket'
import { getPedidosProgramados, marcarPedidoCancelado } from '../services/api'

//Pedidos agendados fuera de horario (ver ADR-002): sección separada del
//dashboard, alimentada por su propio evento de socket para no mezclarse con el
//feed de pedidos activos de ahora (ver useOrdersSocket / evento "nuevo_pedido").
export function usePedidosProgramados(token: string | null) {
  const [pedidos, setPedidos] = useState<Order[]>([])

  useEffect(() => {
    if (!token) return
    const socket: Socket = getSocket(token)

    const onNuevoProgramado = (payload: Order) => {
      setPedidos((prev) => [...prev.filter((p) => p.id !== payload.id), payload])
    }

    socket.on('nuevo_pedido_programado', onNuevoProgramado)
    return () => {
      socket.off('nuevo_pedido_programado', onNuevoProgramado)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    let cancelado = false
    getPedidosProgramados(token)
      .then((pedidos) => {
        if (cancelado) return
        setPedidos((prev) => {
          const idsExistentes = new Set(prev.map((p) => p.id))
          const nuevos = pedidos.filter((p) => !idsExistentes.has(p.id))
          return [...prev, ...nuevos]
        })
      })
      .catch((e) => console.warn('[Pedidos] No se pudieron cargar los pedidos programados:', e))
    return () => { cancelado = true }
  }, [token])

  // Cliente pidió cancelar un pedido agendado antes de que llegue su hora.
  const cancelarProgramado = useCallback((id: string | number) => {
    setPedidos((prev) => prev.filter((p) => String(p.id) !== String(id)))
    if (token) {
      marcarPedidoCancelado(id, token).catch((e) => console.warn('[Pedidos] No se pudo cancelar el pedido programado:', e))
    }
  }, [token])

  return { pedidos, cancelarProgramado }
}
