import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type { Order } from '../types/order'
import { getSocket } from '../services/socket'
import { getPedidosProgramados, marcarPedidoCancelado } from '../services/api'

//Pedidos agendados fuera de horario (ver ADR-002): sección separada del
//dashboard, alimentada por su propio evento de socket para no mezclarse con el
//feed de pedidos activos de ahora (ver useOrdersSocket / evento "nuevo_pedido").
export function usePedidosProgramados(token: string | null) {
  const [pedidos, setPedidos] = useState<Order[]>([])
  // Marca de tiempo del último pedido agregado por socket, para que el poll de
  // abajo sepa si su respuesta quedó "vieja" mientras estaba en vuelo.
  const ultimoEventoSocketEn = useRef(0)

  useEffect(() => {
    if (!token) return
    const socket: Socket = getSocket(token)

    const onNuevoProgramado = (payload: Order) => {
      ultimoEventoSocketEn.current = Date.now()
      setPedidos((prev) => [...prev.filter((p) => p.id !== payload.id), payload])
    }

    socket.on('nuevo_pedido_programado', onNuevoProgramado)
    return () => {
      socket.off('nuevo_pedido_programado', onNuevoProgramado)
    }
  }, [token])

  // Se repite cada 60s: en cuanto la hora agendada llega, el backend deja de
  // devolver ese pedido acá (pasa a GET /api/pedidos, con el botón "Listo") —
  // sin este refresco periódico se quedaba mostrado acá para siempre, sin
  // "Listo", hasta que alguien recargara la página a mano. Por eso reemplaza
  // la lista completa con lo que diga el servidor en vez de solo agregar: así
  // también se cae el que ya venció, no solo se suman los nuevos.
  useEffect(() => {
    if (!token) return
    let cancelado = false
    const cargar = () => {
      // Si llega un pedido nuevo por socket mientras este GET está en vuelo, la
      // respuesta del servidor (calculada con datos de ANTES de ese pedido) lo
      // pisaba al reemplazar toda la lista — desaparecía de la pantalla hasta
      // el siguiente ciclo de 60s. Se descarta esa respuesta puntual en vez de
      // aplicarla; el próximo poll ya vendrá con datos consistentes.
      const pedidoAntesDe = Date.now()
      getPedidosProgramados(token)
        .then((pedidos) => {
          if (cancelado) return
          if (ultimoEventoSocketEn.current > pedidoAntesDe) return
          setPedidos(pedidos)
        })
        .catch((e) => console.warn('[Pedidos] No se pudieron cargar los pedidos programados:', e))
    }
    cargar()
    const intervalo = setInterval(cargar, 60000)
    return () => { cancelado = true; clearInterval(intervalo) }
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
