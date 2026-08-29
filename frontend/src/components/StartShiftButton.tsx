import { Play } from 'lucide-react'

type Props = {
  onStart: () => void
  loading?: boolean
}

export function StartShiftButton({ onStart, loading }: Props) {
  return (
    <button
      onClick={onStart}
      disabled={loading}
      aria-label="Iniciar turno y activar sonido de notificaciones"
      className="group relative flex w-full max-w-[360px] flex-col items-center justify-center gap-3 rounded-[28px] border border-brand-400/30 bg-brand-500 px-8 py-10 text-zinc-900 shadow-lg shadow-black/30 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900/10">
        <Play className="h-8 w-8 translate-x-0.5 fill-current" />
      </span>
      <span className="text-[28px] font-black leading-none tracking-tight">Iniciar Turno</span>
      <span className="text-center text-sm font-semibold leading-tight opacity-70">
        Activa sonido y evita que la pantalla se apague
      </span>
      <span className="mt-1 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-bold tracking-widest text-brand-300">
        {loading ? 'ACTIVANDO...' : 'TOCAR PARA COMENZAR →'}
      </span>
    </button>
  )
}
