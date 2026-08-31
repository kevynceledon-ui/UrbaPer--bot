import { useEffect, useRef, useState, useCallback } from 'react'

export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<any>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Evita llamadas reentrantes: el tap de "Iniciar Turno" pide el lock directo Y
  // el efecto de abajo lo vuelve a pedir al reaccionar al cambio de `enabled` un
  // tick después — sin este guard, ambas llamadas compiten por el mismo
  // videoRef.current y una interrumpe el play() de la otra.
  const requestingRef = useRef(false)
  const [isLocked, setIsLocked] = useState(false)
  const [isFallback, setIsFallback] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Espejo de `isLocked` legible sin que el efecto de abajo dependa de él: si
  // `isLocked` estuviera en las deps de ese efecto, cada `request()` exitoso lo
  // haría re-ejecutarse (porque el propio efecto es quien cambia `isLocked`),
  // lo que dispara un release()+request() en bucle — ese pausa/play constante
  // es la causa real del error "play() interrupted by pause()".
  const isLockedRef = useRef(false)
  useEffect(() => {
    isLockedRef.current = isLocked
  }, [isLocked])

  // No depende de `enabled`: se llama tanto desde el efecto de abajo (mount /
  // volver de background) como directamente desde el gesto de click de "Iniciar
  // Turno" (ver DashboardPage). Safari es estricto con la "user activation" de
  // wakeLock.request(): si se llama después de otros `await` (audio, setState +
  // render), puede rechazarla aunque haya sido un tap real. Por eso el botón la
  // pide ANTES de esperar el desbloqueo de audio, no solo vía este efecto.
  const request = useCallback(async () => {
    if (requestingRef.current) return
    requestingRef.current = true
    try {
    // 1. Intentar API nativa (requiere Secure Context: HTTPS o localhost)
    const hasNative = typeof navigator !== 'undefined' && 'wakeLock' in navigator && window.isSecureContext
    if (hasNative) {
      try {
        const sentinel = await (navigator as any).wakeLock.request('screen')
        sentinelRef.current = sentinel
        setIsLocked(true)
        setIsFallback(false)
        setError(null)
        console.log('[WakeLock] Nativo activado ✓')

        sentinel.addEventListener('release', () => {
          setIsLocked(false)
          sentinelRef.current = null
        })
        return
      } catch (e: any) {
        console.warn('[WakeLock] Nativo falló, usando fallback:', e?.message)
      }
    }

    // 2. Fallback por Video Loop, para navegadores sin la API nativa (ej. Safari
    // < 16.4). El video sale de canvas.captureStream() (generado en el momento,
    // sin depender de bytes de un archivo de video hardcodeados: un intento
    // anterior con un blob WebM escrito a mano estaba corrupto/incompleto y
    // fallaba siempre con "no supported source was found", incluso en Chrome).
    try {
      if (!videoRef.current) {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        canvas.getContext('2d')?.fillRect(0, 0, 1, 1)
        const stream = canvas.captureStream(1)

        const video = document.createElement('video')
        video.setAttribute('playsinline', '')
        video.muted = true
        video.srcObject = stream
        video.width = 1
        video.height = 1
        video.style.position = 'fixed'
        video.style.top = '0'
        video.style.left = '0'
        video.style.opacity = '0.001'
        video.style.pointerEvents = 'none'
        video.style.zIndex = '-9999'
        document.body.appendChild(video)
        videoRef.current = video
      }

      await videoRef.current.play()
      setIsLocked(true)
      setIsFallback(true)
      setError(null)
      console.log('[WakeLock] Fallback video activo ✓')
    } catch (e: any) {
      console.warn('[WakeLock] Fallback video falló:', e?.message)
      setError(e?.message ?? 'No se pudo activar Wake Lock')
      setIsLocked(false)
    }
    } finally {
      requestingRef.current = false
    }
  }, [])

  const release = useCallback(async () => {
    if (sentinelRef.current && !sentinelRef.current.released) {
      try { await sentinelRef.current.release() } catch {}
      sentinelRef.current = null
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause()
        const stream = videoRef.current.srcObject as MediaStream | null
        stream?.getTracks().forEach((t) => t.stop())
        videoRef.current.remove()
      } catch {}
      videoRef.current = null
    }
    setIsLocked(false)
    setIsFallback(false)
  }, [])

  useEffect(() => {
    if (!enabled) {
      void release()
      return
    }

    void request()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && enabled) {
        if (!isLockedRef.current) void request()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
      void release()
    }
  }, [enabled, request, release])

  return { isSupported: true, isLocked, isFallback, error, request, release }
}
