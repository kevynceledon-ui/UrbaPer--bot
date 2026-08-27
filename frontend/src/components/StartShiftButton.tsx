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
      className="group relative flex w-full max-w-[360px] flex-col items-center justify-center gap-3 rounded-[28px] border border-brand-400/30 bg-brand-500 px-8 py-10 text-zinc-900 shadow-lg shadow-black/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
    >
      <span className="text-[44px] leading-none">▶️</span>
      <span className="text-[28px] font-black tracking-tight leading-none">Iniciar Turno</span>
      <span className="text-sm font-semibold opacity-70 text-center leading-tight">
        Activa sonido y evita que la pantalla se apague
      </span>
      <span className="mt-1 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-bold tracking-widest text-brand-300">
        {loading ? 'ACTIVANDO...' : 'TOCAR PARA COMENZAR →'}
      </span>
    </button>
  )
}
