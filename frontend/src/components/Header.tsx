type Props = {
  ordersCount: number
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error'
  wakeLocked: boolean
  wakeSupported: boolean
  audioUnlocked: boolean
  onLogout: () => void
}

export function Header({ ordersCount, connectionState, wakeLocked, wakeSupported, audioUnlocked, onLogout }: Props) {
  const dot =
    connectionState === 'connected' ? 'bg-emerald-400' :
    connectionState === 'connecting' ? 'bg-brand-500 animate-pulse' :
    connectionState === 'error' ? 'bg-red-500' : 'bg-zinc-500'

  // Aclarado explícito: esto es la conexión del panel con el servidor (socket),
  // NO si WhatsApp está vinculado — eran fácil de confundir con el mismo texto "Conectado".
  const label =
    connectionState === 'connected' ? 'Panel conectado' :
    connectionState === 'connecting' ? 'Conectando panel…' :
    connectionState === 'error' ? 'Error de conexión' : 'Panel desconectado'

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl safe-top">
      <div className="mx-auto flex max-w-[520px] items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500 text-zinc-900 font-black text-lg shrink-0">U</div>
          <div className="min-w-0">
            <h1 className="text-sm font-black tracking-tight leading-none">URBAN PERÚ</h1>
            <p className="text-xs font-medium text-zinc-400 leading-none mt-1 flex items-center gap-1.5">
              <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
              {label} · {ordersCount} pedido{ordersCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex flex-col items-end mr-1">
            <span className={`text-[10px] font-bold tracking-widest ${wakeLocked ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {wakeSupported ? (wakeLocked ? '🔆 PANTALLA ACTIVA' : '💤 WAKE LOCK OFF') : 'WAKE NO SOPORTADO'}
            </span>
            <span className={`text-[10px] font-bold tracking-widest ${audioUnlocked ? 'text-emerald-400' : 'text-brand-300'}`}>
              {audioUnlocked ? '🔊 SONIDO ACTIVO' : '🔇 SIN SONIDO'}
            </span>
          </div>
          <button
            onClick={onLogout}
            className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-300 hover:bg-zinc-800 transition"
            aria-label="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </div>

      {/* Barra móvil estado compacta */}
      <div className="flex sm:hidden items-center justify-center gap-3 border-t border-zinc-900 bg-zinc-950 px-3 py-1.5">
        <span className={`text-[11px] font-bold tracking-wide ${wakeLocked ? 'text-emerald-400' : 'text-zinc-500'}`}>{wakeSupported ? (wakeLocked ? '🔆 Pantalla activa' : '💤 Pantalla se apagará') : 'Wake no soportado'}</span>
        <span className="text-zinc-700">·</span>
        <span className={`text-[11px] font-bold tracking-wide ${audioUnlocked ? 'text-emerald-400' : 'text-brand-300'}`}>{audioUnlocked ? '🔊 Sonido' : '🔇 Sin sonido'}</span>
      </div>
    </header>
  )
}
