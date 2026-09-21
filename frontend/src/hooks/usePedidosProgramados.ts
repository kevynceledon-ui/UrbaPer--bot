import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type { Order } from '../types/order'
import { getSocket } from '../services/socket'
import { getPedidosProgramados, marcarPedidoCancelado } from '../services/api'
import { pedirRefrescoDePedidos } from '../utils/refrescar'

//Pedidos agendados fuera de horario (ver ADR-002): sección separada del
//dashboard, alimentada por su propio evento de socket para no mezclarse con el
//feed de pedidos activos de ahora (ver useOrdersSocket / evento "nuevo_pedido").
export function usePedidosProgramados(token: string | null) {
  const [pedidos, setPedidos] = useState<Order[]>([])
  // Marca de tiempo del último pedido agregado por socket, para que el refresco de
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

  // Reemplaza la lista completa con lo que diga el servidor (no solo agrega): así
  // también se cae el pedido cuya hora ya llegó, que pasa a GET /api/pedidos.
  const cargar = useCallback(() => {
    if (!token) return
    // Si llega un pedido nuevo por socket mientras este GET está en vuelo, la
    // respuesta del servidor (calculada con datos de ANTES de ese pedido) lo
    // pisaba al reemplazar toda la lista. Se descarta esa respuesta puntual; el
    // próximo refresco ya vendrá con datos consistentes.
    const pedidoAntesDe = Date.now()
    getPedidosProgramados(token)
      .then((lista) => {
        if (ultimoEventoSocketEn.current > pedidoAntesDe) return
        setPedidos(lista)
      })
      .catch((e) => console.warn('[Pedidos] No se pudieron cargar los pedidos programados:', e))
  }, [token])

  // Al montar y después solo ante eventos reales (reconexión del socket, volver a
  // la pestaña, recuperar internet) — NO por reloj: consultar la base cada minuto
  // la mantenía despierta 24/7 y agotó el cupo de cómputo gratis de Neon.
  useEffect(() => {
    if (!token) return
    const socket: Socket = getSocket(token)
    // Los eventos suelen llegar en ráfaga al abrir la página: si ya se cargó hace
    // un instante no vale la pena repetir.
    let ultimaCargaEn = 0
    const cargarSiHaceFalta = () => {
      if (Date.now() - ultimaCargaEn < 3000) return
      ultimaCargaEn = Date.now()
      cargar()
    }
    const alVolverALaPestana = () => {
      if (document.visibilityState === 'visible') cargarSiHaceFalta()
    }
    ultimaCargaEn = Date.now()
    cargar()
    socket.on('connect', cargarSiHaceFalta)
    document.addEventListener('visibilitychange', alVolverALaPestana)
    window.addEventListener('online', cargarSiHaceFalta)
    return () => {
      socket.off('connect', cargarSiHaceFalta)
      document.removeEventListener('visibilitychange', alVolverALaPestana)
      window.removeEventListener('online', cargarSiHaceFalta)
    }
  }, [token, cargar])

  // Cuando llega la hora de un pedido agendado el backend lo pasa a "activos", pero
  // no emite ningún evento de socket. En vez de preguntar cada minuto, se programa
  // UN aviso para la hora del próximo pedido de la lista: al dispararse se refresca
  // esta lista (el pedido desaparece de acá) y la de activos (aparece con "Listo").
  // Si ya venció y el servidor todavía lo devuelve (reloj del servidor un poco
  // atrasado), reintenta cada 15 s hasta que pase.
  useEffect(() => {
    const horas = pedidos
      .map((p) => (p.horaProgramada ? new Date(p.horaProgramada).getTime() : NaN))
      .filter((n) => !Number.isNaN(n))
    if (horas.length === 0) return
    const siguiente = Math.min(...horas)
    const ahora = Date.now()
    const espera = siguiente <= ahora ? 15000 : Math.min(siguiente - ahora + 2000, 2_147_483_647)
    const temporizador = setTimeout(() => {
      cargar()
      pedirRefrescoDePedidos()
    }, espera)
    return () => clearTimeout(temporizador)
  }, [pedidos, cargar])

  // Cliente pidió cancelar un pedido agendado antes de que llegue su hora.
  const cancelarProgramado = useCallback((id: string | number) => {
    setPedidos((prev) => prev.filter((p) => String(p.id) !== String(id)))
    if (token) {
      marcarPedidoCancelado(id, token).catch((e) => console.warn('[Pedidos] No se pudo cancelar el pedido programado:', e))
    }
  }, [token])

  return { pedidos, cancelarProgramado }
}
