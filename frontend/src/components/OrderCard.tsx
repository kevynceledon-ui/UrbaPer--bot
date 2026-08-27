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

export function OrderCard({ order, isNew, onDismiss }: { order: Order; isNew?: boolean; onDismiss?: (id: string | number) => void }) {
  const tel = order.cliente.telefono.replace(/\D/g, '')
  const waUrl = `https://wa.me/${tel.startsWith('56') ? tel : `56${tel}`}?text=${encodeURIComponent(`Hola ${order.cliente.nombre}, tu pedido #${order.id} está en preparación 🍗`)}`

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

      {/* Header tarjeta */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-zinc-800 px-2 py-1 text-[11px] font-bold tracking-wide text-zinc-400">#{String(order.id).slice(0, 8)}</span>
            <span className="text-xs font-medium text-zinc-500">{formatHora(order.fecha)} · {formatFechaLarga(order.fecha)}</span>
          </div>
          <h3 className="mt-1 truncate text-[18px] font-extrabold leading-none text-white">{order.cliente.nombre}</h3>
          <a href={`tel:${order.cliente.telefono}`} className="text-sm font-medium text-zinc-400 underline decoration-dotted underline-offset-4">
            {order.cliente.telefono}
          </a>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="rounded-2xl bg-brand-500 px-3 py-1.5 text-sm font-black text-zinc-900">
            {formatCLP(order.total)}
          </span>
          {onDismiss && (
            <button
              onClick={() => onDismiss(order.id)}
              className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-400 hover:bg-zinc-700 hover:text-white transition"
              aria-label={`Marcar pedido ${order.id} como listo`}
            >
              ✓ Listo
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
          href={`tel:${order.cliente.telefono}`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-zinc-800 px-4 py-3 text-sm font-bold text-white border border-zinc-700 active:scale-[0.98] transition"
        >
          📞 Llamar
        </a>
      </div>
    </article>
  )
}
