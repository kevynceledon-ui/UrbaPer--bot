import { useEffect, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import type { Order } from '../types/order'
import { getSocket, disconnectSocket } from '../services/socket'
import { playNotificationSound } from '../utils/audio'
import { getPedidosActivos, marcarPedidoEntregado, marcarPedidoNoLlego } from '../services/api'

export function useOrdersSocket(token: string | null, audioUnlocked: boolean) {
  const [orders, setOrders] = useState<Order[]>([])
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
  const [lastOrder, setLastOrder] = useState<Order | null>(null)

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

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.on('nuevo_pedido', onNuevoPedido)

    // Si ya estaba conectado antes de añadir listeners, reflejar
    if (socket.connected) setConnectionState('connected')

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.off('nuevo_pedido', onNuevoPedido)
      // No desconectar aquí inmediatamente si queremos reconexión entre rutas
      // Pero el hook del Dashboard sí debe limpiar al desmontar si se quiere.
    }
  }, [token, addOrder])

  // Recupera los pedidos activos guardados en BD al montar (o si cambia el token):
  // sin esto, recargar la página (ej. el celular descarga la pestaña en segundo
  // plano) deja el dashboard vacío hasta que llegue un pedido nuevo por socket.
  useEffect(() => {
    if (!token) return
    let cancelado = false
    getPedidosActivos(token)
      .then((pedidos) => {
        if (cancelado) return
        setOrders((prev) => {
          const idsExistentes = new Set(prev.map((o) => String(o.id)))
          const nuevos = pedidos.filter((p) => !idsExistentes.has(String(p.id)))
          return [...prev, ...nuevos]
        })
      })
      .catch((e) => console.warn('[Pedidos] No se pudieron cargar pedidos activos:', e))
    return () => { cancelado = true }
  }, [token])

  const clearOrders = useCallback(() => setOrders([]), [])
  const removeOrder = useCallback((id: string | number) => {
    setOrders((prev) => prev.filter(o => String(o.id) !== String(id)))
    // Persiste en BD; si falla, el pedido reaparecerá en el próximo GET /api/pedidos
    // (mejor eso que perder de vista un pedido real por un error de red puntual).
    if (token) {
      marcarPedidoEntregado(id, token).catch((e) => console.warn('[Pedidos] No se pudo marcar como entregado:', e))
    }
  }, [token])

  // Mismo patrón optimista que removeOrder, pero marca "cancelado" en vez de
  // "entregado" — usado por el botón "❌ No llegó" para el historial de no-shows.
  const marcarNoLlego = useCallback((id: string | number) => {
    setOrders((prev) => prev.filter(o => String(o.id) !== String(id)))
    if (token) {
      marcarPedidoNoLlego(id, token).catch((e) => console.warn('[Pedidos] No se pudo marcar como no llegó:', e))
    }
  }, [token])

  // Exponer disconnect manual para logout
  const disconnect = useCallback(() => {
    disconnectSocket()
    setConnectionState('disconnected')
  }, [])

  return { orders, lastOrder, connectionState, clearOrders, removeOrder, marcarNoLlego, disconnect, setOrders }
}
