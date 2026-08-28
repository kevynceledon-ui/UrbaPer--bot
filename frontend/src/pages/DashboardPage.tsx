import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { OrderCard } from '../components/OrderCard'
import { ClienteEsperandoCard } from '../components/ClienteEsperandoCard'
import { StartShiftButton } from '../components/StartShiftButton'
import { useWakeLock } from '../hooks/useWakeLock'
import { useAudioUnlock } from '../hooks/useAudioUnlock'
import { useOrdersSocket } from '../hooks/useOrdersSocket'
import { useWhatsappStatus } from '../hooks/useWhatsappStatus'
import { useClientesEsperando } from '../hooks/useClientesEsperando'
import { playNotificationSound } from '../utils/audio'
import { verifyToken } from '../services/api'
import { disconnectSocket } from '../services/socket'

export function DashboardPage() {
  const nav = useNavigate()
  const token = localStorage.getItem('token')
  const [checking, setChecking] = useState(true)

  // Audio: debe desbloquearse con gesto
  const { unlocked: audioUnlocked, loading: audioLoading, unlock } = useAudioUnlock()
  // Persistido: si el celular descarga la pestaña en segundo plano y recarga, no
  // queremos mandar de vuelta a "Iniciar Turno" (el aviso de "Sonido bloqueado" ya
  // cubre el hecho de que el navegador igual resetea el audio en cada carga nueva).
  const [shiftStarted, setShiftStarted] = useState(() => localStorage.getItem('shiftStarted') === '1')

  // WakeLock solo si el turno inició
  const { isSupported: wakeSupported, isLocked: wakeLocked, error: wakeError } = useWakeLock(shiftStarted)

  // Socket solo si hay token
  const { orders, lastOrder, connectionState, removeOrder, disconnect } = useOrdersSocket(token, audioUnlocked)
  const { qr: whatsappQr } = useWhatsappStatus(token)
  const { clientes: clientesEsperando, devolverAlBot } = useClientesEsperando(token)
  const [highlightId, setHighlightId] = useState<string | number | null>(null)

  // Resalta la tarjeta del último pedido real recibido por socket ("¡NUEVO!")
  useEffect(() => {
    if (!lastOrder) return
    setHighlightId(lastOrder.id)
    const t = setTimeout(() => setHighlightId(null), 4000)
    return () => clearTimeout(t)
  }, [lastOrder])

  // Verificar token al montar
  useEffect(() => {
    if (!token) {
      nav('/login', { replace: true })
      return
    }
    verifyToken(token).then((ok) => {
      if (!ok) {
        localStorage.removeItem('token')
        nav('/login', { replace: true })
      } else {
        setChecking(false)
      }
    })
  }, [token, nav])

  const handleStartShift = useCallback(async () => {
    await unlock()
    // Se inicia igual aunque falle el desbloqueo de audio (el banner de "Sonido
    // bloqueado" permite reintentarlo desde el dashboard).
    localStorage.setItem('shiftStarted', '1')
    setShiftStarted(true)
  }, [unlock])

  const handleLogout = useCallback(() => {
    disconnect()
    disconnectSocket()
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('shiftStarted')
    nav('/login', { replace: true })
  }, [disconnect, nav])

  if (checking) {
    return (
      <div className="min-h-dvh grid place-items-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-800 border-t-brand-400" aria-hidden />
          <p className="text-sm font-medium text-zinc-400">Verificando sesión…</p>
        </div>
      </div>
    )
  }

  // Pantalla gigante Iniciar Turno (bloquea todo hasta interactuar)
  if (!shiftStarted) {
    return (
      <div className="min-h-dvh flex flex-col bg-zinc-950 safe-top safe-bottom">
        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 text-center">
          <div className="mb-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 text-brand-400 font-black">U</div>
            <h1 className="mt-3 text-xl font-black">URBAN PERÚ</h1>
            <p className="text-sm text-zinc-400">Turno de recepción</p>
          </div>

          <StartShiftButton onStart={handleStartShift} loading={audioLoading} />

          <div className="mt-8 max-w-[360px] rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-left">
            <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">¿Por qué este paso?</p>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-zinc-300">
              <li>• Desbloquea el <span className="font-bold text-white">sonido</span> (política autoplay del navegador)</li>
              <li>• Activa <span className="font-bold text-white">Wake Lock</span> para que la pantalla no se apague</li>
              <li>• Requerido una sola vez por turno</li>
            </ul>
          </div>

          <button
            onClick={() => nav('/login')}
            className="mt-6 text-xs font-semibold text-zinc-500 underline decoration-dotted"
          >
            Volver al login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-zinc-950 flex flex-col">
      <Header
        ordersCount={orders.length}
        connectionState={connectionState}
        wakeLocked={wakeLocked}
        wakeSupported={wakeSupported}
        audioUnlocked={audioUnlocked}
        onLogout={handleLogout}
      />

      <main className="mx-auto w-full max-w-[520px] flex-1 px-4 pb-24 pt-4">
        {/* WhatsApp desvinculado: bloquea todo hasta escanear */}
        {whatsappQr && (
          <div role="alert" className="mb-4 rounded-[24px] border border-brand-400/40 bg-zinc-900 p-5 text-center">
            <p className="text-sm font-black tracking-wide text-brand-300 uppercase">WhatsApp desvinculado</p>
            <p className="mt-1 text-sm text-zinc-400">Escanea este código con el WhatsApp del negocio (Dispositivos vinculados) para empezar a recibir pedidos.</p>
            <img
              src={whatsappQr}
              alt="Código QR para vincular WhatsApp"
              className="mx-auto mt-4 h-56 w-56 rounded-2xl border border-zinc-800 bg-white p-2"
            />
            <p className="mt-3 text-xs text-zinc-500">El código expira solo; si se ve viejo, espera a que llegue uno nuevo.</p>
          </div>
        )}

        {/* Clientes esperando atención humana: el bot está pausado para ellos */}
        {clientesEsperando.length > 0 && (
          <div className="mb-4 space-y-2" aria-live="polite">
            <h2 className="text-[11px] font-bold tracking-[0.18em] text-brand-300 uppercase">
              Esperando atención · {clientesEsperando.length}
            </h2>
            {clientesEsperando.map((c) => (
              <ClienteEsperandoCard key={c.telefono} cliente={c} onDevolver={devolverAlBot} />
            ))}
          </div>
        )}

        {/* Avisos superiores */}
        <div className="space-y-2 mb-4">
          {!audioUnlocked && (
            <div role="alert" className="rounded-2xl border border-brand-900/50 bg-brand-950/40 px-4 py-3 flex items-start gap-3">
              <span className="text-lg" aria-hidden>🔇</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-brand-200">Sonido bloqueado</p>
                <p className="text-xs text-brand-200/70">Toca “Probar sonido” para re-activar notificaciones.</p>
              </div>
              <button onClick={() => void playNotificationSound()} className="shrink-0 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-black text-zinc-900">Probar</button>
            </div>
          )}
          {wakeError && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-400">
              Wake Lock: {wakeError} (el celular puede apagarse)
            </div>
          )}
          {connectionState !== 'connected' && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 flex items-center gap-2 text-xs font-medium">
              <span className={`h-2 w-2 rounded-full ${connectionState === 'connecting' ? 'bg-brand-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-zinc-300">
                {connectionState === 'connecting' ? 'Reconectando al servidor…' : connectionState === 'error' ? 'Error de conexión · verifica token / backend' : 'Desconectado del servidor'}
              </span>
            </div>
          )}
        </div>

        {/* Barra acciones */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-[11px] font-bold tracking-[0.18em] text-zinc-500 uppercase">
            Pedidos activos · {orders.length}
          </h2>
          <button
            onClick={() => void playNotificationSound()}
            className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-black text-zinc-900"
          >
            🔊 Probar sonido
          </button>
        </div>

        {/* Lista real */}
        {orders.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 text-2xl">📦</div>
            <h3 className="mt-4 text-base font-bold text-white">Sin pedidos por ahora</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400 max-w-[28ch] mx-auto">
              Los nuevos pedidos aparecerán aquí al instante con sonido y vibración. Mantén este turno activo.
            </p>
            <p className="mt-4 text-xs font-medium text-zinc-600">Escuchando: <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">nuevo_pedido</code> en {import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}</p>
          </div>
        ) : (
          <div className="space-y-3" aria-live="polite" aria-relevant="additions">
            {orders.map(o => (
              <OrderCard key={String(o.id)} order={o} isNew={String(o.id) === String(highlightId)} onDismiss={removeOrder} />
            ))}
          </div>
        )}

        {/* Ayuda */}
        <div className="mt-8 rounded-2xl border border-zinc-900 bg-zinc-900/30 p-4">
          <p className="text-xs font-bold tracking-widest text-zinc-500 uppercase">Consejos para recepción</p>
          <ul className="mt-2 text-xs leading-relaxed text-zinc-400 space-y-1">
            <li>• Sube el volumen del celular al máximo y desactiva “Silencio”.</li>
            <li>• Mantén el cargador conectado; Wake Lock consume batería.</li>
            <li>• Si cambias de app, al volver el lock se re-activa solo.</li>
          </ul>
        </div>
      </main>

      {/* Audio fallback oculto (si se quisiera usar mp3) */}
      <audio id="fallback-audio" preload="auto" className="hidden" aria-hidden>
        <source src="/notification.mp3" type="audio/mpeg" />
      </audio>
    </div>
  )
}
