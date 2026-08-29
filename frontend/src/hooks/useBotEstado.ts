import { useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { getSocket } from '../services/socket'
import { getConfiguracion } from '../services/api'

export function useBotEstado(token: string | null) {
  const [activo, setActivo] = useState(true)
  const [mensajePausa, setMensajePausa] = useState('')
  // Franjas de agenda fuera de horario (ver ADR-002). Valores temporales hasta
  // que la dueña confirme cuántos pedidos puede tener listos en paralelo.
  const [duracionFranjaMin, setDuracionFranjaMin] = useState(15)
  const [capacidadPorFranja, setCapacidadPorFranja] = useState(1)

  // Estado inicial vía HTTP: sobrevive a un recargo de página, igual que
  // getPedidosActivos/getClientesEsperando.
  useEffect(() => {
    if (!token) return
    getConfiguracion(token)
      .then((c) => {
        setActivo(c.activo)
        setMensajePausa(c.mensajePausa)
        setDuracionFranjaMin(c.duracionFranjaMin)
        setCapacidadPorFranja(c.capacidadPorFranja)
      })
      .catch((e) => console.warn('No se pudo cargar la configuración del bot:', e))
  }, [token])

  // Cambios en tiempo real desde otro dispositivo conectado al dashboard.
  useEffect(() => {
    if (!token) return
    const socket: Socket = getSocket(token)
    const onBotEstado = (payload: { activo: boolean; mensajePausa?: string }) => {
      setActivo(payload.activo)
      if (payload.mensajePausa != null) setMensajePausa(payload.mensajePausa)
    }
    socket.on('bot_estado', onBotEstado)
    return () => {
      socket.off('bot_estado', onBotEstado)
    }
  }, [token])

  return {
    activo,
    setActivo,
    mensajePausa,
    setMensajePausa,
    duracionFranjaMin,
    setDuracionFranjaMin,
    capacidadPorFranja,
    setCapacidadPorFranja,
  }
}
