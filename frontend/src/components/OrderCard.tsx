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

type Props = {
  order: Order
  isNew?: boolean
  onDismiss?: (id: string | number) => void
  onNoLlego?: (id: string | number) => void
}

export function OrderCard({ order, isNew, onDismiss, onNoLlego }: Props) {
  const tel = numeroLimpio(order.cliente.telefono)
  const telIntl = tel.startsWith('56') ? tel : `56${tel}`
  const waUrl = `https://wa.me/${telIntl}?text=${encodeURIComponent(`Hola ${order.cliente.nombre}, tu pedido #${order.id} está en preparación 🍗`)}`

  return (
    <article
      className={`animate-slide-in relative flex flex-col gap-3 rounded-[20px] border bg-zinc-900 p-4 shadow-xl shadow-black/30 transition-all
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
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
          ⚠️ Este cliente tiene {order.clienteNoShows} pedido{order.clienteNoShows !== 1 ? 's' : ''} anterior{order.clienteNoShows !== 1 ? 'es' : ''} no retirado{order.clienteNoShows !== 1 ? 's' : ''}
        </p>
      )}

      {/* Header tarjeta */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-zinc-800 px-2 py-1 text-[11px] font-bold tracking-wide text-zinc-400">#{String(order.id).slice(0, 8)}</span>
            <span className="text-xs font-medium text-zinc-500">{formatHora(order.fecha)} · {formatFechaLarga(order.fecha)}</span>
          </div>
          <h3 className="mt-1 truncate text-[18px] font-extrabold leading-none text-white">{order.cliente.nombre}</h3>
          <a href={`tel:+${telIntl}`} className="text-sm font-medium text-zinc-400 underline decoration-dotted underline-offset-4">
            +{telIntl}
          </a>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="rounded-2xl bg-brand-500 px-3 py-1.5 text-sm font-black text-zinc-900">
            {formatCLP(order.total)}
          </span>
          {order.metodoPago && (
            <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] font-bold text-zinc-300">
              {order.metodoPago === 'efectivo' ? '💵 Efectivo' : '🏦 Transferencia'}
            </span>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(order.id)}
              className="rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-zinc-900 shadow-md shadow-emerald-500/20 hover:bg-emerald-400 active:scale-[0.98] transition"
              aria-label={`Marcar pedido ${order.id} como listo`}
            >
              ✓ Listo
            </button>
          )}
          {onNoLlego && (
            <button
              onClick={() => onNoLlego(order.id)}
              className="text-[11px] font-semibold text-zinc-500 underline decoration-dotted hover:text-red-400 transition"
              aria-label={`Marcar pedido ${order.id} como no retirado`}
            >
              ❌ No llegó
            </button>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="rounded-2xl bg-zinc-950 border border-zinc-800/80 p-3">
        <p className="text-[11px] font-bold tracking-widest text-zinc-500 uppercase mb-2">Detalle</p>
        <ul className="space-y-1.5">
          {order.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-2 text-sm">
              <span className="text-zinc-200 font-medium truncate pr-2">
                <span className="text-zinc-500 font-mono text-xs mr-1.5">{it.cantidad ? `${it.cantidad}x` : '1x'}</span>
                {it.nombre}
              </span>
              <span className="font-mono text-zinc-400 shrink-0">{formatCLP(it.precio)}</span>
            </li>
          ))}
        </ul>
        {order.comprobanteImagen && (
          <a
            href={order.comprobanteImagen}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900 p-2"
            aria-label="Ver comprobante de transferencia a tamaño completo"
          >
            <img src={order.comprobanteImagen} alt="Comprobante de transferencia" className="h-14 w-14 rounded-lg object-cover border border-zinc-800" />
            <span className="text-xs font-bold text-zinc-300">🧾 Ver comprobante de transferencia</span>
          </a>
        )}
        {order.resumen && (
          <p className="mt-3 rounded-xl bg-brand-500/10 border border-brand-500/20 px-3 py-2 text-sm font-medium text-brand-200">
            📝 {order.resumen}
          </p>
        )}
      </div>

      {/* Acciones */}
      <div className="flex gap-2">
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-3 py-3 text-sm font-bold text-white shadow-md active:scale-[0.98] transition"
          aria-label={`Contactar por WhatsApp a ${order.cliente.nombre}`}
        >
          <span className="text-base">💬</span> WhatsApp
        </a>
        <a
          href={`tel:+${telIntl}`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-zinc-800 px-4 py-3 text-sm font-bold text-white border border-zinc-700 active:scale-[0.98] transition"
        >
          📞 Llamar
        </a>
      </div>
    </article>
  )
}
