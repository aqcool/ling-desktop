import { describe, expect, it } from 'vitest'
import { parseAppearance, resolveTheme } from '../src/theme.js'

describe('appearance preferences', () => {
  it('keeps existing light and dark preferences and defaults invalid settings', () => {
    expect(parseAppearance(['dark'])).toEqual({ mode: 'dark', palette: 'default', terminal: 'follow', terminalDark: false })
    expect(parseAppearance(['broken', 'broken', 'broken'])).toEqual(parseAppearance([]))
    expect(parseAppearance([]).mode).toBe('system')
  })
  it('keeps palette and terminal preferences independent of the application mode', () => {
    expect(parseAppearance(['system', 'forest', 'manual', 'true'])).toEqual({ mode: 'system', palette: 'forest', terminal: 'manual', terminalDark: true })
  })
  it('reacts to OS changes only in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})
