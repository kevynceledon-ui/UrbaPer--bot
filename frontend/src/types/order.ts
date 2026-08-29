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
export type Modalidad = 'delivery' | 'retiro'

export interface Order {
  id: string | number
  cliente: Cliente
  items: OrderItem[]
  total: number
  resumen: string
  metodoPago?: MetodoPago | null
  comprobanteImagen?: string | null
  clienteNoShows?: number
  modalidad?: Modalidad | null
  direccion?: string | null
  montoRecibido?: number | null
  vuelto?: number | null
  tiempoEstimadoMin?: number | null
  tiempoEstimadoMax?: number | null
  horaProgramada?: string | null // ISO string, solo si es un pedido agendado (ver ADR-002)
  fecha: string // ISO string
}

export type NuevoPedidoPayload = Order

export interface ClienteEsperando {
  telefono: string
  nombre: string
  desde: string // ISO string
}
