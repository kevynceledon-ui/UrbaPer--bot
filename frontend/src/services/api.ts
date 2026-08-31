function resolveApiUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined

  if (!envUrl) {
    if (import.meta.env.DEV) return 'http://localhost:3000'
    console.error('VITE_API_URL no está definida en este build de producción.')
    return ''
  }

  // Solo en dev local: si el frontend se abre vía IP LAN (ej: 192.168.1.6:5173) pero
  // VITE_API_URL apunta a localhost, el fetch desde el celular intentaría localhost del
  // celular -> falla. Reemplaza host dinámicamente. Fuera de dev esto es peligroso: si
  // VITE_API_URL no llegó al build, terminaría apuntando al propio dominio de producción.
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    try {
      const u = new URL(envUrl)
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        u.hostname = window.location.hostname
        return u.toString().replace(/\/$/, '')
      }
    } catch { /* ignore parse */ }
  }
  return envUrl
}
const API_URL = resolveApiUrl()

export interface LoginResponse {
  ok: boolean
  token: string
  expiresIn: string
  user: string
}

export async function login(user: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'Credenciales inválidas')
  }
  return data as LoginResponse
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    return res.ok && data.ok === true
  } catch {
    return false
  }
}

export function getApiUrl(): string {
  return API_URL
}

//Pedidos activos guardados en BD (no entregados/cancelados). Se usa para recuperar
//lo que haya quedado pendiente cuando el Dashboard recarga (ej. el celular descarga
//la pestaña en segundo plano) en vez de depender solo del evento en vivo del socket.
export async function getPedidosActivos(token: string): Promise<import('../types/order').Order[]> {
  const res = await fetch(`${API_URL}/api/pedidos`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudieron cargar los pedidos')
  }
  return data.pedidos
}

//Pedidos agendados fuera de horario (ver ADR-002) cuya hora todavía no llega —
//sección separada del dashboard, no se mezclan con los pedidos activos de ahora.
export async function getPedidosProgramados(token: string): Promise<import('../types/order').Order[]> {
  const res = await fetch(`${API_URL}/api/pedidos/programados`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudieron cargar los pedidos programados')
  }
  return data.pedidos
}

export type EstadoPedido = 'comprando' | 'pendiente' | 'preparando' | 'listo' | 'entregado' | 'cancelado'

export async function actualizarEstadoPedido(id: string | number, estado: EstadoPedido, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/pedidos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ estado }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudo actualizar el pedido')
  }
}

export function marcarPedidoEntregado(id: string | number, token: string): Promise<void> {
  return actualizarEstadoPedido(id, 'entregado', token)
}

export function marcarPedidoNoLlego(id: string | number, token: string): Promise<void> {
  return actualizarEstadoPedido(id, 'cancelado', token)
}

//Clientes que pidieron hablar con una persona y el bot todavía tiene pausado.
export async function getClientesEsperando(token: string): Promise<import('../types/order').ClienteEsperando[]> {
  const res = await fetch(`${API_URL}/api/clientes/necesitan-humano`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudo cargar la lista')
  }
  return data.clientes
}

export async function reanudarBot(telefono: string, token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/clientes/${telefono}/reanudar-bot`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudo devolver el bot')
  }
}

//Fuerza cerrar la sesión actual de WhatsApp y generar un QR nuevo (botón
//"Reiniciar vínculo" para cuando el bot queda en un estado raro sin esperar
//a un redeploy).
export async function reiniciarWhatsapp(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/whatsapp/reiniciar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudo reiniciar el vínculo')
  }
}

export interface ConfiguracionBot {
  activo: boolean
  mensajePausa: string
  //Franjas de agenda fuera de horario (ver ADR-002).
  duracionFranjaMin: number
  capacidadPorFranja: number
  //Aviso adicional por WhatsApp al número de turno cuando llega un pedido nuevo
  //(parche para cuando el sonido del dashboard no es confiable, celular bloqueado).
  notificacionesWhatsappActivas: boolean
  numeroNotificaciones: string | null
}

function mapearConfiguracion(data: any): ConfiguracionBot {
  return {
    activo: data.activo,
    mensajePausa: data.mensajePausa,
    duracionFranjaMin: data.duracionFranjaMin,
    capacidadPorFranja: data.capacidadPorFranja,
    notificacionesWhatsappActivas: data.notificacionesWhatsappActivas,
    numeroNotificaciones: data.numeroNotificaciones,
  }
}

//Botón de pausa/emergencia: corta las respuestas automáticas del bot.
export async function getConfiguracion(token: string): Promise<ConfiguracionBot> {
  const res = await fetch(`${API_URL}/api/configuracion`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudo cargar la configuración')
  }
  return mapearConfiguracion(data)
}

export async function actualizarConfiguracion(
  token: string,
  cambios: Partial<ConfiguracionBot>
): Promise<ConfiguracionBot> {
  const res = await fetch(`${API_URL}/api/configuracion`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(cambios),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? 'No se pudo actualizar la configuración')
  }
  return mapearConfiguracion(data)
}
