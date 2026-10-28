import { useEffect, useRef } from 'react'
import type {} from '../runtime/application-update.js'

/** Read current renderer state only when main requests its final installation handoff. */
export function useApplicationUpdateGuard(check: () => string | undefined) {
  const latest = useRef(check)
  latest.current = check
  const bridge = typeof window === 'undefined' ? undefined : window.__LING_UPDATE__
  useEffect(() => bridge?.beforeInstall?.(() => latest.current()), [bridge])
}
