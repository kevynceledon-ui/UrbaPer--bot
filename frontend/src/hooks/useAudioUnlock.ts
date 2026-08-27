import { useCallback, useState } from 'react'
import { unlockAudio, playStartSound, isAudioUnlocked } from '../utils/audio'

export function useAudioUnlock() {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked())
  const [loading, setLoading] = useState(false)

  const unlock = useCallback(async () => {
    setLoading(true)
    const ok = await unlockAudio()
    if (ok) {
      await playStartSound()
      setUnlocked(true)
    }
    setLoading(false)
    return ok
  }, [])

  return { unlocked, loading, unlock }
}
