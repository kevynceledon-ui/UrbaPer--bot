import { io, Socket } from 'socket.io-client'

function resolveApiUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined

  if (!envUrl) {
    if (import.meta.env.DEV) return 'http://localhost:3000'
    console.error('VITE_API_URL no está definida en este build de producción.')
    return ''
  }

  // Solo en dev local (ver services/api.ts para el detalle del porqué).
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    try {
      const u = new URL(envUrl)
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        u.hostname = window.location.hostname
        return u.toString().replace(/\/$/, '')
      }
    } catch { /* ignore */ }
  }
  return envUrl
}
const API_URL = resolveApiUrl()

let socket: Socket | null = null

export function getSocket(token: string): Socket {
  // Si ya existe y tiene mismo token, reutilizar
  if (socket?.connected) return socket

  // Desconectar previo si existe
  if (socket) {
    socket.disconnect()
    socket = null
  }

  socket = io(API_URL, {
    auth: { token: `Bearer ${token}` },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    timeout: 8000,
    autoConnect: true,
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export function getCurrentSocket(): Socket | null {
  return socket
}
