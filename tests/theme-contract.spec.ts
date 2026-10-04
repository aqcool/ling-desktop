import { describe, expect, it } from 'vitest'
import { palettes, parseWindowAppearance, terminalMode, terminalTheme, themeTokens } from '../src/theme/tokens.js'
import { tw } from '../src/ui/tailwind.js'

function luminance(color: string): number {
  const values = color.slice(1).match(/../g)!.map(value => {
    const channel = Number.parseInt(value, 16) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return .2126 * values[0]! + .7152 * values[1]! + .0722 * values[2]!
}
function contrast(a: string, b: string) {
  const first = luminance(a), second = luminance(b)
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
}

describe('portable theme contract', () => {
  for (const { id } of palettes) for (const mode of ['light', 'dark'] as const) {
    it(`${id}/${mode} keeps native, terminal and UI colors readable and resolvable`, () => {
      const tokens = themeTokens(mode, id)
      expect(Object.values(tokens).some(value => value.includes('var('))).toBe(false)
      expect(contrast(tokens.foreground!, tokens.surface!)).toBeGreaterThanOrEqual(7)
      expect(contrast(tokens['text-secondary']!, tokens.surface!)).toBeGreaterThanOrEqual(4.5)
      for (const state of ['danger', 'success', 'warning']) expect(contrast(tokens[state]!, tokens.surface!)).toBeGreaterThanOrEqual(4.5)
      const terminal = terminalTheme(mode, id)
      expect(terminal.background).toBe(tokens['terminal-background'])
      expect(contrast(terminal.foreground, terminal.background)).toBeGreaterThanOrEqual(7)
      for (const color of Object.values(terminal)) expect(color).toMatch(/^#[\da-f]{6}(?:[\da-f]{2})?$/i)
    })
  }
  it('honors manual terminal mode while keeping the selected palette', () => {
    const appearance = { mode: 'light', palette: 'forest', terminal: 'manual', terminalDark: true } as const
    expect(terminalMode(appearance, 'light')).toBe('dark')
    expect(terminalMode({ ...appearance, terminal: 'follow' }, 'light')).toBe('light')
    expect(terminalTheme('dark', appearance.palette).background).not.toBe(terminalTheme('dark', 'default').background)
  })
  for (const mode of ['light', 'dark'] as const) {
    it(`keeps Windows XP chrome and primary actions readable in ${mode} mode`, () => {
      const tokens = themeTokens(mode, 'windows-xp')
      for (const background of ['chrome-start', 'chrome-end', 'chrome-hover']) {
        expect(contrast(tokens['chrome-foreground']!, tokens[background]!)).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(tokens['action-foreground']!, tokens.action!)).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('accepts only known window appearance values and strips unrelated fields', () => {
    expect(parseWindowAppearance({ mode: 'system', palette: 'mint', password: 'unrelated' })).toEqual({ mode: 'system', palette: 'mint' })
    for (const palette of ['__proto__', 'constructor', '<script>', null]) expect(parseWindowAppearance({ mode: 'dark', palette })).toBeUndefined()
    expect(parseWindowAppearance({ mode: 'invalid', palette: 'forest' })).toBeUndefined()
  })
  it('preserves theme font sizes alongside text colors and merges control sizes', () => {
    expect(tw('text-compact text-[var(--foreground)]')).toBe('text-compact text-[var(--foreground)]')
    expect(tw('text-caption text-compact')).toBe('text-compact')
    expect(tw('size-control size-7')).toBe('size-7')
    expect(tw('h-8 h-control-sm')).toBe('h-control-sm')
  })
})
