import { useEffect, useRef, useState, useCallback } from 'react'

export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<any>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isLocked, setIsLocked] = useState(false)
  const [isFallback, setIsFallback] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(async () => {
    if (!enabled) return

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

    // 2. Fallback por Video Loop (funciona en HTTP LAN / móviles sin HTTPS)
    try {
      if (!videoRef.current) {
        const video = document.createElement('video')
        video.setAttribute('playsinline', '')
        video.setAttribute('muted', '')
        video.setAttribute('loop', '')
        video.width = 1
        video.height = 1
        video.style.position = 'fixed'
        video.style.top = '0'
        video.style.left = '0'
        video.style.opacity = '0.001'
        video.style.pointerEvents = 'none'
        video.style.zIndex = '-9999'

        // Tiny transparent video webm blob
        const webmBytes = new Uint8Array([
          0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
          0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84, 0x76, 0x70, 0xeb, 0x6d, 0x18, 0x53, 0x80, 0x67,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1d, 0x16, 0x54, 0xae, 0x6b, 0x81, 0x00, 0xae, 0x42,
          0x85, 0x81, 0x01, 0x42, 0x87, 0x81, 0x01, 0x1f, 0x43, 0xb6, 0x75, 0x81, 0x01, 0xec, 0x81, 0x00
        ])
        const blob = new Blob([webmBytes], { type: 'video/webm' })
        video.src = URL.createObjectURL(blob)
        document.body.appendChild(video)
        videoRef.current = video
      }

      await videoRef.current.play()
      setIsLocked(true)
      setIsFallback(true)
      setError(null)
      console.log('[WakeLock] Fallback video activo ✓ (HTTP LAN)')
    } catch (e: any) {
      console.warn('[WakeLock] Fallback video falló:', e?.message)
      setError(e?.message ?? 'No se pudo activar Wake Lock')
      setIsLocked(false)
    }
  }, [enabled])

  const release = useCallback(async () => {
    if (sentinelRef.current && !sentinelRef.current.released) {
      try { await sentinelRef.current.release() } catch {}
      sentinelRef.current = null
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause()
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
        if (!isLocked) void request()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleVisibility)
      void release()
    }
  }, [enabled, request, release, isLocked])

  return { isSupported: true, isLocked, isFallback, error, request, release }
}
