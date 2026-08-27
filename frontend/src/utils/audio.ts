/**
 * Lógica de desbloqueo de Audio y notificación sonora.
 * Cumple la Política de Autoplay del navegador:
 * - Requiere gesto del usuario (click en "Iniciar Turno") para desbloquear AudioContext
 * - Usa Web Audio API para generar un beep sin depender de archivo externo
 * - Fallback a <audio> con mp3 si está disponible
 */

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null
let isUnlocked = false

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
    audioCtx = new Ctx()
    masterGain = audioCtx.createGain()
    masterGain.gain.value = 0.6
    masterGain.connect(audioCtx.destination)
  }
  return audioCtx
}

/**
 * Desbloquea la API de Audio. DEBE llamarse dentro de un handler de click/touch.
 * 1. Crea/resume AudioContext
 * 2. Reproduce un buffer silencioso de 1ms (truco para iOS/Safari)
 * 3. Genera un micro-beep inaudible para confirmar
 */
export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = getAudioContext()

    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    // Buffer silencioso de 1ms → desbloquea autoplay en iOS/Chrome
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)

    // Micro beep de confirmación opcional (muy corto y bajo)
    // Comentado para no molestar, pero valida que el contexto funciona

    isUnlocked = true
    console.log('[Audio] Desbloqueado ✓ state:', ctx.state)
    return true
  } catch (e) {
    console.warn('[Audio] No se pudo desbloquear:', e)
    return false
  }
}

export function isAudioUnlocked(): boolean {
  return isUnlocked
}

/**
 * Reproduce sonido de notificación.
 * Usa Web Audio API → no requiere archivo externo y no falla por 404.
 * Patrón: doble beep ascendente (tipo "nuevo pedido")
 */
export async function playNotificationSound(): Promise<void> {
  try {
    const ctx = getAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()

    const now = ctx.currentTime
    const gain = masterGain ?? ctx.createGain()
    if (!masterGain) gain.connect(ctx.destination)

    // Función helper para un tono
    const playTone = (freq: number, start: number, duration: number, type: OscillatorType = 'sine', volume = 0.8) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      osc.connect(g)
      g.connect(gain)
      g.gain.setValueAtTime(0, start)
      g.gain.linearRampToValueAtTime(volume, start + 0.02)
      g.gain.exponentialRampToValueAtTime(0.01, start + duration)
      osc.start(start)
      osc.stop(start + duration)
    }

    // Patrón: beep-beep-beep (urgente pero agradable)
    // Frecuencias tipo "ding dong" restaurante
    playTone(880, now, 0.22, 'sine', 0.9)          // A5
    playTone(1108.73, now + 0.24, 0.22, 'sine', 0.9) // C#6
    playTone(1318.51, now + 0.48, 0.38, 'sine', 1.0) // E6 largo

    // Armónico sutil para cuerpo
    playTone(440, now, 0.2, 'triangle', 0.25)
    playTone(554.37, now + 0.24, 0.2, 'triangle', 0.25)

    // Vibración si está disponible (móvil)
    if ('vibrate' in navigator) {
      navigator.vibrate([180, 80, 180, 80, 350])
    }
  } catch (e) {
    console.warn('[Audio] playNotificationSound falló:', e)
    // Fallback: intenta reproducir <audio> element si existe
    const el = document.getElementById('fallback-audio') as HTMLAudioElement | null
    if (el) {
      el.currentTime = 0
      el.play().catch(() => {})
    }
  }
}

/**
 * Totem / Iniciar Turno feedback sonoro corto
 */
export async function playStartSound(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  const now = ctx.currentTime
  const playTone = (freq: number, start: number, dur: number) => {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.frequency.value = freq
    osc.type = 'sine'
    osc.connect(g)
    g.connect(masterGain ?? ctx.destination)
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(0.7, start + 0.02)
    g.gain.exponentialRampToValueAtTime(0.01, start + dur)
    osc.start(start)
    osc.stop(start + dur)
  }
  playTone(523.25, now, 0.15)
  playTone(659.25, now + 0.14, 0.15)
  playTone(783.99, now + 0.28, 0.25)
}
