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

export interface Order {
  id: string | number
  cliente: Cliente
  items: OrderItem[]
  total: number
  resumen: string
  fecha: string // ISO string
}

export type NuevoPedidoPayload = Order

export interface ClienteEsperando {
  telefono: string
  nombre: string
  desde: string // ISO string
}
