import { useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { getSocket } from '../services/socket'

export function useWhatsappStatus(token: string | null) {
  const [qr, setQr] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!token) return
    const socket: Socket = getSocket(token)

    const onQr = (payload: { qr: string }) => {
      setQr(payload.qr)
      setReady(false)
    }
    const onReady = () => {
      setQr(null)
      setReady(true)
    }

    socket.on('whatsapp_qr', onQr)
    socket.on('whatsapp_ready', onReady)

    return () => {
      socket.off('whatsapp_qr', onQr)
      socket.off('whatsapp_ready', onReady)
    }
  }, [token])

  return { qr, ready }
}
