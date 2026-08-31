import { useCallback, useState } from 'react'
import { unlockAudio, playStartSound, isAudioUnlocked } from '../utils/audio'

export function useAudioUnlock() {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked())
  const [loading, setLoading] = useState(false)

  const unlock = useCallback(async () => {
    setLoading(true)
    try {
      const ok = await unlockAudio()
      if (ok) {
        // No debe bloquear el desbloqueo si el beep de confirmación falla por
        // cualquier razón (algunos navegadores/estados de AudioContext) — lo
        // que importa es que el contexto ya quedó desbloqueado.
        try {
          await playStartSound()
        } catch (e) {
          console.warn('[Audio] playStartSound falló, pero el contexto igual quedó desbloqueado:', e)
        }
        setUnlocked(true)
      }
      return ok
    } catch (e) {
      console.warn('[Audio] unlock falló:', e)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { unlocked, loading, unlock }
}
