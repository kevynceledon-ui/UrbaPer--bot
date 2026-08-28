import { useEffect, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import type { ClienteEsperando } from '../types/order'
import { getSocket } from '../services/socket'
import { getClientesEsperando, reanudarBot as reanudarBotApi } from '../services/api'

export function useClientesEsperando(token: string | null) {
  const [clientes, setClientes] = useState<ClienteEsperando[]>([])

  useEffect(() => {
    if (!token) return
    const socket: Socket = getSocket(token)

    const onNecesitaHumano = (payload: ClienteEsperando) => {
      setClientes((prev) => [payload, ...prev.filter((c) => c.telefono !== payload.telefono)])
    }
    const onBotReanudado = ({ telefono }: { telefono: string }) => {
      setClientes((prev) => prev.filter((c) => c.telefono !== telefono))
    }

    socket.on('cliente_necesita_humano', onNecesitaHumano)
    socket.on('cliente_bot_reanudado', onBotReanudado)

    return () => {
      socket.off('cliente_necesita_humano', onNecesitaHumano)
      socket.off('cliente_bot_reanudado', onBotReanudado)
    }
  }, [token])

  // Recupera la lista al montar, igual que los pedidos activos, para que sobreviva
  // a una recarga de la página.
  useEffect(() => {
    if (!token) return
    let cancelado = false
    getClientesEsperando(token)
      .then((clientes) => {
        if (cancelado) return
        setClientes((prev) => {
          const idsExistentes = new Set(prev.map((c) => c.telefono))
          const nuevos = clientes.filter((c) => !idsExistentes.has(c.telefono))
          return [...prev, ...nuevos]
        })
      })
      .catch((e) => console.warn('[Clientes] No se pudo cargar la lista de espera:', e))
    return () => { cancelado = true }
  }, [token])

  const devolverAlBot = useCallback((telefono: string) => {
    setClientes((prev) => prev.filter((c) => c.telefono !== telefono))
    if (token) {
      reanudarBotApi(telefono, token).catch((e) => console.warn('[Clientes] No se pudo devolver el bot:', e))
    }
  }, [token])

  return { clientes, devolverAlBot }
}
