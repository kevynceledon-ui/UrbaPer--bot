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
  // Reutiliza la instancia existente aunque todavía no haya terminado de conectar:
  // el dashboard llama a getSocket() desde varios hooks (useOrdersSocket,
  // useWhatsappStatus, useClientesEsperando) casi en el mismo instante al montar.
  // Antes se comparaba socket.connected, que en un socket recién creado sigue en
  // false por unos milisegundos (el handshake es async) — cada hook posterior
  // desconectaba el socket del hook anterior y creaba uno nuevo, dejando a los
  // primeros escuchando eventos en un socket ya muerto. Socket.IO encola los
  // listeners y los emits sin problema aunque el handshake no haya terminado, así
  // que no hace falta esperar a "connected" para reutilizar la instancia.
  if (socket) return socket

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
