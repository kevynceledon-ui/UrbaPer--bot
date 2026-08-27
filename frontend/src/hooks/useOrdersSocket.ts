import { useEffect, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import type { Order } from '../types/order'
import { getSocket, disconnectSocket } from '../services/socket'
import { playNotificationSound } from '../utils/audio'

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

  const clearOrders = useCallback(() => setOrders([]), [])
  const removeOrder = useCallback((id: string | number) => {
    setOrders((prev) => prev.filter(o => String(o.id) !== String(id)))
  }, [])

  // Exponer disconnect manual para logout
  const disconnect = useCallback(() => {
    disconnectSocket()
    setConnectionState('disconnected')
  }, [])

  return { orders, lastOrder, connectionState, clearOrders, removeOrder, disconnect, setOrders }
}
