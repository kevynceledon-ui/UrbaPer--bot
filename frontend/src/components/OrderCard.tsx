import {
  CheckCircle2,
  XCircle,
  Ban,
  Bike,
  Store,
  Banknote,
  Landmark,
  MapPin,
  CalendarClock,
  Clock,
  Receipt,
  StickyNote,
  MessageCircle,
  Phone,
  AlertTriangle,
} from 'lucide-react'
import type { Order } from '../types/order'

function formatHora(fecha: string): string {
  try {
    const d = new Date(fecha)
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch {
    return fecha.slice(11, 16) ?? fecha
  }
}

function formatFechaLarga(fecha: string): string {
  try {
    const d = new Date(fecha)
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return fecha }
}

function formatCLP(valor: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(valor)
}

// Se queda solo con los dígitos del número (11 en Chile: 56 9 XXXXXXXX). Corta
// cualquier sufijo tipo ":idDispositivo" que WhatsApp multi-dispositivo agrega al
// JID antes de limpiar, para no arrastrar esos dígitos pegados al número real.
function numeroLimpio(telefono: string): string {
  return telefono.split(':')[0].replace(/\D/g, '')
}

// Pill informativo chico (modalidad, pago, tiempo) — mismo peso visual para
// todos, deliberadamente por debajo de las acciones reales de la tarjeta.
function InfoPill({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/80 px-2.5 py-1 text-[11px] font-bold text-zinc-300">
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      {children}
    </span>
  )
}

type Props = {
  order: Order
  isNew?: boolean
  onDismiss?: (id: string | number) => void
  onNoLlego?: (id: string | number) => void
  onCancelar?: (id: string | number) => void
}

export function OrderCard({ order, isNew, onDismiss, onNoLlego, onCancelar }: Props) {
  const tel = numeroLimpio(order.cliente.telefono)
  const telIntl = tel.startsWith('56') ? tel : `56${tel}`
  const waUrl = `https://wa.me/${telIntl}?text=${encodeURIComponent(`Hola ${order.cliente.nombre}, tu pedido #${order.id} está en preparación 🍗`)}`

  return (
    <article
      className={`animate-slide-in relative flex flex-col gap-4 rounded-[20px] border bg-zinc-900 p-4 shadow-lg shadow-black/20 transition-colors
        ${isNew ? 'border-brand-400/50 ring-1 ring-brand-400/20' : 'border-zinc-800'}
      `}
      aria-label={`Pedido ${order.id} de ${order.cliente.nombre}`}
    >
      {isNew && (
        <span className="absolute -right-2 -top-2 rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-black tracking-widest text-zinc-900 shadow-md">
          ¡NUEVO!
        </span>
      )}

      {/* Aviso de no-shows: informativo, la decisión la toma el equipo */}
      {!!order.clienteNoShows && order.clienteNoShows > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Este cliente tiene {order.clienteNoShows} pedido{order.clienteNoShows !== 1 ? 's' : ''} anterior{order.clienteNoShows !== 1 ? 'es' : ''} no retirado{order.clienteNoShows !== 1 ? 's' : ''}
        </p>
      )}

      {/* Identidad + monto: lo primero que se lee, sin competir con badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-bold tracking-wide text-zinc-400">#{String(order.id).slice(0, 8)}</span>
            <span className="text-xs font-medium text-zinc-500">{formatHora(order.fecha)} · {formatFechaLarga(order.fecha)}</span>
          </div>
          <h3 className="mt-1.5 truncate text-[19px] font-extrabold leading-tight text-white">{order.cliente.nombre}</h3>
          <a href={`tel:+${telIntl}`} className="text-sm font-medium text-zinc-400 underline decoration-zinc-700 decoration-2 underline-offset-4 hover:text-zinc-200">
            +{telIntl}
          </a>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="rounded-2xl bg-brand-500 px-3.5 py-2 text-base font-black leading-none text-zinc-900">
            {formatCLP(order.total)}
          </span>
          {/* Tercer nivel: rara vez se usa y su consecuencia es opuesta a "Listo" —
              se aleja a propósito del bloque de acciones de abajo para que un toque
              apurado nunca la alcance por error. */}
          {onNoLlego && (
            <button
              onClick={() => onNoLlego(order.id)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-zinc-500 transition hover:text-red-400"
              aria-label={`Marcar pedido ${order.id} como no retirado`}
            >
              <XCircle className="h-3.5 w-3.5" />
              No llegó
            </button>
          )}
          {/* Distinto de "No llegó": acá el cliente avisó ANTES de venir a buscarlo,
              mientras el pedido ya podía estar en cocina. Misma zona quieta, lejos
              de "Listo", para que no se confunda con la acción principal. */}
          {onCancelar && (
            <button
              onClick={() => onCancelar(order.id)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-zinc-500 transition hover:text-red-400"
              aria-label={`Cancelar pedido ${order.id}`}
            >
              <Ban className="h-3.5 w-3.5" />
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Badges informativos: mismo peso entre sí, todos por debajo de la acción principal */}
      {(order.modalidad || order.metodoPago || order.tiempoEstimadoMin != null || order.horaProgramada) && (
        <div className="-mt-1 flex flex-wrap gap-1.5">
          {order.modalidad && (
            <InfoPill icon={order.modalidad === 'delivery' ? Bike : Store}>
              {order.modalidad === 'delivery' ? 'Delivery' : 'Retiro'}
            </InfoPill>
          )}
          {order.metodoPago && (
            <InfoPill icon={order.metodoPago === 'efectivo' ? Banknote : Landmark}>
              {order.metodoPago === 'efectivo' ? 'Efectivo' : 'Transferencia'}
            </InfoPill>
          )}
          {order.tiempoEstimadoMin != null && order.tiempoEstimadoMax != null && (
            <InfoPill icon={Clock}>{order.tiempoEstimadoMin}-{order.tiempoEstimadoMax} min</InfoPill>
          )}
          {order.horaProgramada && (
            <InfoPill icon={CalendarClock}>Agendado {formatHora(order.horaProgramada)}</InfoPill>
          )}
        </div>
      )}

      {/* Detalle */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950 p-3">
        <p className="mb-2 text-[11px] font-bold tracking-widest text-zinc-500 uppercase">Detalle</p>
        <ul className="space-y-1.5">
          {order.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-2 text-sm">
              <span className="truncate pr-2 font-medium text-zinc-200">
                <span className="mr-1.5 font-mono text-xs text-zinc-500">{it.cantidad ? `${it.cantidad}x` : '1x'}</span>
                {it.nombre}
              </span>
              <span className="shrink-0 font-mono text-zinc-400">{formatCLP(it.precio)}</span>
            </li>
          ))}
        </ul>
        {order.direccion && (
          <p className="mt-3 flex items-start gap-2 text-sm text-zinc-300">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            {order.direccion}
          </p>
        )}
        {order.vuelto != null && (
          <p className="mt-1.5 flex items-start gap-2 text-sm text-zinc-300">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
            Paga con {formatCLP(order.montoRecibido ?? 0)} · vuelto {formatCLP(order.vuelto)}
          </p>
        )}
        {order.comprobanteImagen && (
          <a
            href={order.comprobanteImagen}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900 p-2 transition hover:border-zinc-700"
            aria-label="Ver comprobante de transferencia a tamaño completo"
          >
            <img src={order.comprobanteImagen} alt="Comprobante de transferencia" className="h-14 w-14 rounded-lg border border-zinc-800 object-cover" />
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-300">
              <Receipt className="h-4 w-4 shrink-0" />
              Ver comprobante de transferencia
            </span>
          </a>
        )}
        {order.resumen && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-sm font-medium text-brand-200">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
            {order.resumen}
          </p>
        )}
      </div>

      {/* Acción principal: la única razón por la que se abre esta tarjeta */}
      {onDismiss && (
        <button
          onClick={() => onDismiss(order.id)}
          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3.5 text-base font-black text-zinc-900 shadow-md shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]"
          aria-label={`Marcar pedido ${order.id} como listo`}
        >
          <CheckCircle2 className="h-5 w-5" />
          Listo
        </button>
      )}

      {/* Contacto: secundario frente a "Listo", pero más presente que "No llegó" */}
      <div className="flex gap-2">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-3 py-2.5 text-sm font-bold text-white shadow-sm transition active:scale-[0.98]"
          aria-label={`Contactar por WhatsApp a ${order.cliente.nombre}`}
        >
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </a>
        <a
          href={`tel:+${telIntl}`}
          className="flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.98]"
        >
          <Phone className="h-4 w-4" />
          Llamar
        </a>
      </div>
    </article>
  )
}
