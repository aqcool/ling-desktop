import { useEffect, useState } from 'react'

import { appearanceKeys as keys, parseAppearance, resolveTheme, themeTokens, type Appearance } from './theme/tokens.js'
export { palettes, isPalette, parseAppearance, resolveTheme, terminalMode, terminalTheme, metrics } from './theme/tokens.js'
export type { Appearance, LingTheme, LingPalette, ResolvedTheme } from './theme/tokens.js'
const changeEvent = 'ling:appearance-changed'

export function readAppearance(): Appearance {
  try { return parseAppearance(keys.map(key => window.localStorage.getItem(key))) }
  catch { return parseAppearance([]) }
}
export function updateAppearance(patch: Partial<Appearance>): void {
  const next = { ...readAppearance(), ...patch }
  const values = [next.mode, next.palette, next.terminal, String(next.terminalDark)]
  try { keys.forEach((key, index) => window.localStorage.setItem(key, values[index]!)) } catch {}
  window.dispatchEvent(new Event(changeEvent))
}
export function useAppearance() {
  const [appearance, setAppearance] = useState(readAppearance)
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const refresh = () => { setAppearance(readAppearance()) }
    const storage = (event: StorageEvent) => { if (event.key === null || keys.some(key => key === event.key)) refresh() }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const changed = () => { setSystemDark(media.matches) }
    window.addEventListener(changeEvent, refresh)
    window.addEventListener('storage', storage)
    media.addEventListener('change', changed)
    refresh()
    changed()
    return () => {
      window.removeEventListener(changeEvent, refresh)
      window.removeEventListener('storage', storage)
      media.removeEventListener('change', changed)
    }
  }, [])
  return { ...appearance, resolved: resolveTheme(appearance.mode, systemDark) }
}

export function applyAppearance(appearance: Appearance, resolved: 'light' | 'dark'): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.palette = appearance.palette
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  root.style.backgroundColor = themeTokens(resolved, appearance.palette).surface!
}

export function initializeAppearance(): void {
  const appearance = readAppearance()
  applyAppearance(appearance, resolveTheme(appearance.mode, window.matchMedia('(prefers-color-scheme: dark)').matches))
}
