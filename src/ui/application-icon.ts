import icon3 from '../assets/application-icons/fold-coral.png'
import icon4 from '../assets/application-icons/fold-indigo.png'
import icon5 from '../assets/application-icons/relay-dark.png'
import icon6 from '../assets/application-icons/relay-light.png'
import { useEffect, useState } from 'react'

export type ApplicationIconStyle = 'fold-coral' | 'fold-indigo' | 'relay-dark' | 'relay-light'
interface IconSnapshot { readonly style: ApplicationIconStyle; readonly styles: readonly ApplicationIconStyle[] }
interface ApplicationIconBridge {
  get(): Promise<IconSnapshot>
  set(style: ApplicationIconStyle): Promise<IconSnapshot>
  subscribe(callback: (snapshot: IconSnapshot) => void): () => void
}
const iconPreviews: Record<ApplicationIconStyle, string> = {
  'fold-coral': icon3,
  'fold-indigo': icon4,
  'relay-dark': icon5,
  'relay-light': icon6,
}
export function applicationIconPreview(style: ApplicationIconStyle): string { return iconPreviews[style] }

export const applicationIconOptions = [
  { value: 'fold-coral', label: '折面 · 珊瑚' }, { value: 'fold-indigo', label: '折面 · 靛蓝' },
  { value: 'relay-dark', label: '接力 · 极光' }, { value: 'relay-light', label: '接力 · 晨彩' },
] as const

function nativeApplicationIcon(): ApplicationIconBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { __LING_APP_ICON__?: ApplicationIconBridge }).__LING_APP_ICON__
}

export function useApplicationIcon(enabled: boolean) {
  const bridge = nativeApplicationIcon()
  const [snapshot, setSnapshot] = useState<IconSnapshot>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!enabled || !bridge) return
    let active = true
    let changed = false
    const unsubscribe = bridge.subscribe(value => { changed = true; if (active) setSnapshot(value) })
    void bridge.get().then(value => { if (active && !changed) setSnapshot(value) }, cause => { if (active) setError(cause instanceof Error ? cause.message : '应用图标无法读取，请重试。') })
    return () => { active = false; unsubscribe() }
  }, [enabled, bridge])
  const select = async (style: string) => {
    if (!bridge || pending || !applicationIconOptions.some(option => option.value === style)) return
    setPending(true)
    setError(undefined)
    try { setSnapshot(await bridge.set(style as ApplicationIconStyle)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '应用图标切换失败，请重试。') }
    finally { setPending(false) }
  }
  return { style: snapshot?.style ?? 'fold-indigo', available: Boolean(bridge), pending, error, select }
}
