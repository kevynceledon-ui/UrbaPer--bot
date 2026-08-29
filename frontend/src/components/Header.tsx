import { Moon, Sun, Volume2, VolumeX } from 'lucide-react'

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
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-500 text-lg font-black text-zinc-900">U</div>
          <div className="min-w-0">
            <h1 className="text-sm font-black leading-none tracking-tight">URBAN PERÚ</h1>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium leading-none text-zinc-400">
              <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
              {label} · {ordersCount} pedido{ordersCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-3 sm:flex">
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-wide ${wakeLocked ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {wakeSupported ? (wakeLocked ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />) : null}
              {wakeSupported ? (wakeLocked ? 'Pantalla activa' : 'Pantalla se apagará') : 'Wake no soportado'}
            </span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-wide ${audioUnlocked ? 'text-emerald-400' : 'text-brand-300'}`}>
              {audioUnlocked ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              {audioUnlocked ? 'Sonido activo' : 'Sin sonido'}
            </span>
          </div>
          <button
            onClick={onLogout}
            className="rounded-full border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800"
            aria-label="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </div>

      {/* Barra móvil estado compacta */}
      <div className="flex items-center justify-center gap-3 border-t border-zinc-900 bg-zinc-950 px-3 py-1.5 sm:hidden">
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-wide ${wakeLocked ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {wakeSupported ? (wakeLocked ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />) : null}
          {wakeSupported ? (wakeLocked ? 'Pantalla activa' : 'Pantalla se apagará') : 'Wake no soportado'}
        </span>
        <span className="text-zinc-700">·</span>
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold tracking-wide ${audioUnlocked ? 'text-emerald-400' : 'text-brand-300'}`}>
          {audioUnlocked ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {audioUnlocked ? 'Sonido' : 'Sin sonido'}
        </span>
      </div>
    </header>
  )
}
