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
import { useBotEstado } from '../hooks/useBotEstado'
import { usePedidosProgramados } from '../hooks/usePedidosProgramados'
import { playNotificationSound } from '../utils/audio'
import { verifyToken, reiniciarWhatsapp, actualizarConfiguracion } from '../services/api'
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
  const { isSupported: wakeSupported, isLocked: wakeLocked, error: wakeError, request: requestWakeLock } = useWakeLock(shiftStarted)

  // Socket solo si hay token
  const { orders, lastOrder, connectionState, removeOrder, marcarNoLlego, disconnect } = useOrdersSocket(token, audioUnlocked)
  const { qr: whatsappQr } = useWhatsappStatus(token)
  const { clientes: clientesEsperando, devolverAlBot } = useClientesEsperando(token)
  const {
    activo: botActivo,
    setActivo: setBotActivo,
    mensajePausa,
    setMensajePausa,
    duracionFranjaMin,
    setDuracionFranjaMin,
    capacidadPorFranja,
    setCapacidadPorFranja,
  } = useBotEstado(token)
  const { pedidos: pedidosProgramados } = usePedidosProgramados(token)
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
    // Wake Lock primero, sin ningún `await` antes: Safari es estricto con la
    // "user activation" del tap y puede rechazar wakeLock.request() si llega
    // después de esperar el desbloqueo de audio (ver useWakeLock.ts).
    void requestWakeLock()
    await unlock()
    // Se inicia igual aunque falle el desbloqueo de audio (el banner de "Sonido
    // bloqueado" permite reintentarlo desde el dashboard).
    localStorage.setItem('shiftStarted', '1')
    setShiftStarted(true)
  }, [unlock, requestWakeLock])

  const handleLogout = useCallback(() => {
    disconnect()
    disconnectSocket()
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('shiftStarted')
    nav('/login', { replace: true })
  }, [disconnect, nav])

  // Botón de emergencia: fuerza cerrar la sesión de WhatsApp y pedir un QR nuevo,
  // para cuando el bot queda "listo" pero en realidad no responde, o quedó a medio
  // vincular de una prueba anterior — sin depender de un redeploy para limpiarlo.
  const [reiniciando, setReiniciando] = useState(false)
  const handleReiniciarWhatsapp = useCallback(async () => {
    if (!token) return
    if (!window.confirm('Esto va a cerrar la sesión actual de WhatsApp y vas a tener que escanear un QR nuevo. ¿Continuar?')) return
    setReiniciando(true)
    try {
      await reiniciarWhatsapp(token)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No se pudo reiniciar el vínculo')
    } finally {
      setReiniciando(false)
    }
  }, [token])

  // Pausa de emergencia: corta las respuestas automáticas del bot sin redeploy.
  // Mientras está pausado, el bot responde siempre `mensajePausa` a cualquier
  // mensaje entrante (ver ConfiguracionBot / whatsappServices.ts).
  const [cambiandoPausa, setCambiandoPausa] = useState(false)
  const handleTogglePausa = useCallback(async () => {
    if (!token) return
    const nuevoActivo = !botActivo
    if (!nuevoActivo && !window.confirm('El bot dejará de responder automáticamente a los clientes hasta que lo reactives. ¿Continuar?')) return
    setCambiandoPausa(true)
    try {
      const cfg = await actualizarConfiguracion(token, { activo: nuevoActivo })
      setBotActivo(cfg.activo)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No se pudo cambiar el estado del bot')
    } finally {
      setCambiandoPausa(false)
    }
  }, [token, botActivo, setBotActivo])

  const [guardandoMensaje, setGuardandoMensaje] = useState(false)
  const handleGuardarConfiguracion = useCallback(async () => {
    if (!token) return
    setGuardandoMensaje(true)
    try {
      await actualizarConfiguracion(token, { mensajePausa, duracionFranjaMin, capacidadPorFranja })
      window.alert('Configuración guardada.')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No se pudo guardar la configuración')
    } finally {
      setGuardandoMensaje(false)
    }
  }, [token, mensajePausa, duracionFranjaMin, capacidadPorFranja])

  const botonReiniciar = (
    <button
      onClick={handleReiniciarWhatsapp}
      disabled={reiniciando}
      className="text-xs font-semibold text-zinc-500 underline decoration-dotted hover:text-red-400 disabled:opacity-50 transition"
    >
      {reiniciando ? 'Reiniciando…' : '⚠️ ¿WhatsApp no responde? Reiniciar vínculo'}
    </button>
  )

  // El QR llega por socket sin importar en qué pantalla estés (los hooks se montan
  // igual). Se extrae para poder mostrarlo también en las pantallas de abajo, que
  // antes lo recibían pero nunca lo dibujaban por estar en un return anterior.
  const qrBanner = whatsappQr && (
    <div role="alert" className="mb-4 rounded-[24px] border border-brand-400/40 bg-zinc-900 p-5 text-center">
      <p className="text-sm font-black tracking-wide text-brand-300 uppercase">WhatsApp desvinculado</p>
      <p className="mt-1 text-sm text-zinc-400">Escanea este código con el WhatsApp del negocio (Dispositivos vinculados) para empezar a recibir pedidos.</p>
      <img
        src={whatsappQr}
        alt="Código QR para vincular WhatsApp"
        className="mx-auto mt-4 h-56 w-56 rounded-2xl border border-zinc-800 bg-white p-2"
      />
      <p className="mt-3 text-xs text-zinc-500">El código expira solo; si se ve viejo, espera a que llegue uno nuevo.</p>
      <div className="mt-3">{botonReiniciar}</div>
    </div>
  )

  if (checking) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-6 bg-zinc-950 px-5">
        {qrBanner && <div className="w-full max-w-[360px]">{qrBanner}</div>}
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
          {qrBanner && <div className="w-full max-w-[360px] mb-2 text-left">{qrBanner}</div>}

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
        {qrBanner}

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

        {/* Si ya hay un QR mostrándose, el botón de reinicio ya viene incluido ahí
            arriba — no lo dupliques. Este es para cuando el bot "parece" listo pero
            en realidad no está respondiendo. */}
        {!qrBanner && (
          <div className="mb-4 text-center">{botonReiniciar}</div>
        )}

        {/* Pausa de emergencia: si está pausado, se muestra siempre arriba de todo
            para que el equipo no se olvide de reactivarlo. */}
        {!botActivo && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-red-300">⏸ Bot pausado</p>
              <p className="text-xs text-red-300/70">Los clientes reciben el mensaje automático, no se están tomando pedidos.</p>
            </div>
            <button
              onClick={handleTogglePausa}
              disabled={cambiandoPausa}
              className="shrink-0 rounded-full bg-red-500 px-3 py-1.5 text-xs font-black text-zinc-900 disabled:opacity-50"
            >
              {cambiandoPausa ? '…' : 'Reactivar'}
            </button>
          </div>
        )}

        <details className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <summary className="cursor-pointer text-xs font-bold tracking-widest text-zinc-500 uppercase select-none">
            Configuración del bot
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-zinc-300">{botActivo ? 'Tomando pedidos' : 'Pausado'}</span>
              <button
                onClick={handleTogglePausa}
                disabled={cambiandoPausa}
                className={`rounded-full px-4 py-1.5 text-xs font-black transition disabled:opacity-50 ${botActivo ? 'bg-zinc-800 text-zinc-300 border border-zinc-700' : 'bg-red-500 text-zinc-900'}`}
              >
                {cambiandoPausa ? '…' : botActivo ? 'Pausar bot' : 'Pausado'}
              </button>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1">Mensaje mientras está pausado</label>
              <textarea
                value={mensajePausa}
                onChange={(e) => setMensajePausa(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-zinc-500 mb-1">Franja de agenda (min)</label>
                <input
                  type="number"
                  min={1}
                  value={duracionFranjaMin}
                  onChange={(e) => setDuracionFranjaMin(Number(e.target.value) || 1)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 mb-1">Cupo por franja</label>
                <input
                  type="number"
                  min={1}
                  value={capacidadPorFranja}
                  onChange={(e) => setCapacidadPorFranja(Number(e.target.value) || 1)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                />
              </div>
            </div>
            <button
              onClick={handleGuardarConfiguracion}
              disabled={guardandoMensaje}
              className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-black text-zinc-900 disabled:opacity-50"
            >
              {guardandoMensaje ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        </details>

        {/* Pedidos agendados fuera de horario (ver ADR-002): sección separada,
            no se mezclan con "Pedidos activos" hasta que llegue su hora. */}
        {pedidosProgramados.length > 0 && (
          <div className="mb-4 space-y-2">
            <h2 className="text-[11px] font-bold tracking-[0.18em] text-brand-300 uppercase">
              Pedidos programados · {pedidosProgramados.length}
            </h2>
            {pedidosProgramados.map((o) => (
              <OrderCard key={String(o.id)} order={o} />
            ))}
          </div>
        )}

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
              <OrderCard key={String(o.id)} order={o} isNew={String(o.id) === String(highlightId)} onDismiss={removeOrder} onNoLlego={marcarNoLlego} />
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
