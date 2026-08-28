export interface Cliente {
  nombre: string
  telefono: string
  whatsapp: string
}

export interface OrderItem {
  nombre: string
  precio: number
  cantidad?: number
}

export type MetodoPago = 'efectivo' | 'transferencia'

export interface Order {
  id: string | number
  cliente: Cliente
  items: OrderItem[]
  total: number
  resumen: string
  metodoPago?: MetodoPago | null
  comprobanteImagen?: string | null
  clienteNoShows?: number
  fecha: string // ISO string
}

export type NuevoPedidoPayload = Order

export interface ClienteEsperando {
  telefono: string
  nombre: string
  desde: string // ISO string
}
