import { useEffect, useState, useCallback, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import type { Order } from '../types/order'
import { getSocket, disconnectSocket } from '../services/socket'
import { playNotificationSound } from '../utils/audio'
import { EVENTO_REFRESCAR_PEDIDOS } from '../utils/refrescar'
import { getPedidosActivos, marcarPedidoEntregado, marcarPedidoNoLlego, marcarPedidoCancelado } from '../services/api'

export function useOrdersSocket(token: string | null, audioUnlocked: boolean) {
  const [orders, setOrders] = useState<Order[]>([])
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
  const [lastOrder, setLastOrder] = useState<Order | null>(null)
  // IDs que se sacaron de la lista de forma optimista (botón "Listo"/"No
  // llegó"/"Cancelar") pero cuyo PATCH todavía no confirma en el backend. Los
  // refrescos de más abajo los ignoran mientras estén acá — si no, un GET que
  // ya estaba en vuelo cuando se tocó el botón podía volver a agregar el
  // pedido que el staff recién sacó, porque en la BD todavía figuraba activo.
  const pendingRemovals = useRef<Set<string>>(new Set())

  const addOrder = useCallback((order: Order) => {
    setOrders((prev) => [order, ...prev])
    setLastOrder(order)
    if (audioUnlocked) {
      void playNotificationSound()
    } else {
      // Aún sin unlock: vibra si puede + alerta visual se encargará
      if ('vibrate' in navigator) navigator.vibrate([250, 100, 250])
    }
  }, [audioUnlocked])

  useEffect(() => {
    if (!token) {
      setConnectionState('disconnected')
      return
    }

    setConnectionState('connecting')
    const socket: Socket = getSocket(token)

    const onConnect = () => {
      console.log('[Socket] Conectado', socket.id)
      setConnectionState('connected')
    }
    const onDisconnect = (reason: string) => {
      console.log('[Socket] Desconectado:', reason)
      setConnectionState('disconnected')
    }
    const onConnectError = (err: Error) => {
      console.warn('[Socket] Error:', err.message)
      setConnectionState('error')
    }
    const onNuevoPedido = (payload: Order) => {
      console.log('[Socket] nuevo_pedido', payload)
      addOrder(payload)
    }
    // Otro dashboard (u otra pestaña) marcó un pedido como entregado/cancelado
    // vía PATCH — sin escuchar esto, este dashboard solo se enteraba al
    // volver a pedir los pedidos o al recargar la página.
    const onPedidoActualizado = (payload: { id: string; estado: string }) => {
      if (payload.estado === 'entregado' || payload.estado === 'cancelado') {
        setOrders((prev) => prev.filter((o) => String(o.id) !== String(payload.id)))
      }
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('nuevo_pedido', onNuevoPedido)
    socket.on('pedido_actualizado', onPedidoActualizado)

    // Si ya estaba conectado antes de añadir listeners, reflejar
    if (socket.connected) setConnectionState('connected')

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('nuevo_pedido', onNuevoPedido)
      socket.off('pedido_actualizado', onPedidoActualizado)
      // No desconectar aquí inmediatamente si queremos reconexión entre rutas
      // Pero el hook del Dashboard sí debe limpiar al desmontar si se quiere.
    }
  }, [token, addOrder])

  // Recupera los pedidos activos guardados en BD: al montar (recargar la página
  // dejaría el dashboard vacío hasta el próximo pedido por socket) y después SOLO
  // ante eventos reales — reconexión del socket, volver a la pestaña, recuperar
  // internet, o el aviso de que llegó la hora de un pedido agendado. Antes se
  // repetía cada 60 s por reloj: con una pestaña abierta (el turno mantiene la
  // pantalla encendida) la base de Neon nunca llegaba a suspenderse y agotó el
  // cupo mensual de cómputo del plan gratis. Los pedidos nuevos ya llegan por
  // Socket.IO; este GET es solo la red de seguridad para lo que se haya perdido.
  useEffect(() => {
    if (!token) return
    let cancelado = false
    const cargar = () => {
      getPedidosActivos(token)
        .then((pedidos) => {
          if (cancelado) return
          setOrders((prev) => {
            const idsExistentes = new Set(prev.map((o) => String(o.id)))
            const nuevos = pedidos.filter(
              (p) => !idsExistentes.has(String(p.id)) && !pendingRemovals.current.has(String(p.id))
            )
            return nuevos.length > 0 ? [...prev, ...nuevos] : prev
          })
        })
        .catch((e) => console.warn('[Pedidos] No se pudieron cargar pedidos activos:', e))
    }
    // Los eventos suelen llegar en ráfaga al abrir la página (conexión del socket,
    // foco de la pestaña…): si ya se cargó hace un instante no vale la pena repetir.
    let ultimaCargaEn = 0
    const cargarSiHaceFalta = () => {
      if (Date.now() - ultimaCargaEn < 3000) return
      ultimaCargaEn = Date.now()
      cargar()
    }
    const alVolverALaPestana = () => {
      if (document.visibilityState === 'visible') cargarSiHaceFalta()
    }
    const socket: Socket = getSocket(token)

    ultimaCargaEn = Date.now()
    cargar()
    socket.on('connect', cargarSiHaceFalta)
    document.addEventListener('visibilitychange', alVolverALaPestana)
    window.addEventListener('online', cargarSiHaceFalta)
    // El aviso de "llegó la hora de un pedido agendado" SÍ se atiende siempre.
    window.addEventListener(EVENTO_REFRESCAR_PEDIDOS, cargar)
    return () => {
      cancelado = true
      socket.off('connect', cargarSiHaceFalta)
      document.removeEventListener('visibilitychange', alVolverALaPestana)
      window.removeEventListener('online', cargarSiHaceFalta)
      window.removeEventListener(EVENTO_REFRESCAR_PEDIDOS, cargar)
    }
  }, [token])

  const clearOrders = useCallback(() => setOrders([]), [])
  const removeOrder = useCallback((id: string | number) => {
    const idStr = String(id)
    pendingRemovals.current.add(idStr)
    setOrders((prev) => prev.filter(o => String(o.id) !== idStr))
    // Persiste en BD; si falla, el pedido reaparecerá en el próximo GET /api/pedidos
    // (mejor eso que perder de vista un pedido real por un error de red puntual).
    if (token) {
      marcarPedidoEntregado(id, token)
        .catch((e) => console.warn('[Pedidos] No se pudo marcar como entregado:', e))
        .finally(() => pendingRemovals.current.delete(idStr))
    } else {
      pendingRemovals.current.delete(idStr)
    }
  }, [token])

  // Mismo patrón optimista que removeOrder, pero marca "cancelado" en vez de
  // "entregado" — usado por el botón "❌ No llegó" para el historial de no-shows.
  const marcarNoLlego = useCallback((id: string | number) => {
    const idStr = String(id)
    pendingRemovals.current.add(idStr)
    setOrders((prev) => prev.filter(o => String(o.id) !== idStr))
    if (token) {
      marcarPedidoNoLlego(id, token)
        .catch((e) => console.warn('[Pedidos] No se pudo marcar como no llegó:', e))
        .finally(() => pendingRemovals.current.delete(idStr))
    } else {
      pendingRemovals.current.delete(idStr)
    }
  }, [token])

  // Cliente pidió cancelar mientras el pedido ya estaba en curso (distinto del
  // caso de "No llegó": acá el equipo se entera antes de que llegue a buscarlo).
  const cancelarPedido = useCallback((id: string | number) => {
    const idStr = String(id)
    pendingRemovals.current.add(idStr)
    setOrders((prev) => prev.filter(o => String(o.id) !== idStr))
    if (token) {
      marcarPedidoCancelado(id, token)
        .catch((e) => console.warn('[Pedidos] No se pudo cancelar el pedido:', e))
        .finally(() => pendingRemovals.current.delete(idStr))
    } else {
      pendingRemovals.current.delete(idStr)
    }
  }, [token])

  // Exponer disconnect manual para logout
  const disconnect = useCallback(() => {
    disconnectSocket()
    setConnectionState('disconnected')
  }, [])

  return { orders, lastOrder, connectionState, clearOrders, removeOrder, marcarNoLlego, cancelarPedido, disconnect, setOrders }
}
