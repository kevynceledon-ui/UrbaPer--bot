import type { ClienteEsperando } from '../types/order'

// Se queda solo con los dígitos del número (11 en Chile: 56 9 XXXXXXXX). Corta
// cualquier sufijo tipo ":idDispositivo" que WhatsApp multi-dispositivo agrega al
// JID antes de limpiar, para no arrastrar esos dígitos pegados al número real.
function numeroLimpio(telefono: string): string {
  return telefono.split(':')[0].replace(/\D/g, '')
}

function formatEspera(desde: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000))
  if (minutos < 1) return 'recién'
  if (minutos === 1) return 'hace 1 min'
  return `hace ${minutos} min`
}

export function ClienteEsperandoCard({ cliente, onDevolver }: { cliente: ClienteEsperando; onDevolver: (telefono: string) => void }) {
  const tel = numeroLimpio(cliente.telefono)
  const telIntl = tel.startsWith('56') ? tel : `56${tel}`
  const waUrl = `https://wa.me/${telIntl}`

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-brand-400/30 bg-zinc-900 p-3.5">
      <span className="text-xl shrink-0" aria-hidden>🙋</span>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-extrabold text-white">{cliente.nombre}</h4>
        <p className="text-xs font-medium text-zinc-500">Pidió ayuda humana · {formatEspera(cliente.desde)}</p>
      </div>
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded-full bg-[#25D366] px-3 py-2 text-xs font-bold text-white shadow-md active:scale-[0.98] transition"
        aria-label={`Abrir WhatsApp con ${cliente.nombre}`}
      >
        💬 WhatsApp
      </a>
      <button
        onClick={() => onDevolver(cliente.telefono)}
        className="shrink-0 rounded-full bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition"
        aria-label={`Devolver al bot a ${cliente.nombre}`}
      >
        ✓ Devolver al bot
      </button>
    </article>
  )
}
