import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAppearance, parseAppearance, readAppearance, resolveTheme, updateAppearance } from '../src/theme.js'
import { appearanceKeys, appearanceStyles, appearanceValues, metrics, themeTokens } from '../src/theme/tokens.js'

afterEach(() => vi.unstubAllGlobals())

describe('appearance preferences', () => {
  it('keeps existing light and dark preferences and defaults invalid settings', () => {
    expect(parseAppearance(['dark'])).toEqual({ mode: 'dark', palette: 'default', terminal: 'follow', terminalDark: false, fontStyle: 'system', contentWidth: 'standard', fileIcons: 'simple', glass: true })
    expect(parseAppearance(['broken', 'broken', 'broken'])).toEqual(parseAppearance([]))
    expect(parseAppearance([]).mode).toBe('system')
  })
  it('keeps palette and terminal preferences independent of the application mode', () => {
    expect(parseAppearance(['system', 'forest', 'manual', 'true'])).toEqual({ ...parseAppearance([]), mode: 'system', palette: 'forest', terminal: 'manual', terminalDark: true })
  })
  it('reacts to OS changes only in system mode', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
  it('round-trips presentation settings while preserving old preference positions', () => {
    const appearance = { ...parseAppearance([]), fontStyle: 'serif', contentWidth: 'wide', fileIcons: 'color', glass: false } as const
    const values = appearanceValues(appearance)
    expect(values.slice(0, 4)).toEqual(['system', 'default', 'follow', 'false'])
    expect(parseAppearance(values)).toEqual(appearance)
    expect(parseAppearance(['dark', 'mint', 'manual', 'true', 'bad', '999px', '<script>', 'bad'])).toEqual({ ...parseAppearance([]), mode: 'dark', palette: 'mint', terminal: 'manual', terminalDark: true })
  })
  it('saves a partial preference change and broadcasts it without losing existing settings', () => {
    const data = new Map<string, string>([['ling.palette', 'windows-xp'], ['ling.terminal-theme', 'manual'], ['ling.terminal-dark', 'true']])
    const target = Object.assign(new EventTarget(), { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } })
    vi.stubGlobal('window', target)
    const changed = vi.fn()
    target.addEventListener('ling:appearance-changed', changed)
    updateAppearance({ fontStyle: 'sans', contentWidth: 'narrow', fileIcons: 'color', glass: false })
    expect(readAppearance()).toEqual({ ...parseAppearance([]), palette: 'windows-xp', terminal: 'manual', terminalDark: true, fontStyle: 'sans', contentWidth: 'narrow', fileIcons: 'color', glass: false })
    expect(appearanceKeys.every(key => data.has(key))).toBe(true)
    expect(changed).toHaveBeenCalledOnce()
  })
  it('preserves original theme fonts and reading width until explicitly overridden', () => {
    expect(appearanceStyles(parseAppearance([]))).toEqual({ 'font-ui': undefined, 'reading-width': undefined })
    expect(themeTokens('light', 'windows-xp')['font-ui']).toContain('Tahoma')
    expect(metrics['reading-width']).toBe('48rem')
    expect(appearanceStyles({ fontStyle: 'serif', contentWidth: 'wide' })['font-ui']).toContain('Songti SC')
    expect(appearanceStyles({ fontStyle: 'serif', contentWidth: 'wide' })['reading-width']).toBe('64rem')
  })
  it('applies live styles and removes overrides on reset, keeping the code font untouched', () => {
    const properties = new Map([['--font-code', 'custom-code-font']])
    const root = { dataset: {} as Record<string, string>, classList: { toggle: vi.fn() }, style: { colorScheme: '', backgroundColor: '', setProperty: (key: string, value: string) => properties.set(key, value), removeProperty: (key: string) => properties.delete(key) } }
    vi.stubGlobal('document', { documentElement: root })
    applyAppearance({ ...parseAppearance([]), palette: 'windows-xp', fontStyle: 'serif', contentWidth: 'narrow', fileIcons: 'color', glass: false }, 'dark')
    expect(root.dataset).toEqual({ theme: 'dark', palette: 'windows-xp', fontStyle: 'serif', contentWidth: 'narrow', fileIcons: 'color', glass: 'false' })
    expect(properties.get('--reading-width')).toBe('40rem')
    expect(properties.get('--font-ui')).toContain('Songti SC')
    applyAppearance({ ...parseAppearance([]), palette: 'windows-xp' }, 'light')
    expect(properties.has('--reading-width')).toBe(false)
    expect(properties.has('--font-ui')).toBe(false)
    expect(properties.get('--font-code')).toBe('custom-code-font')
    expect(root.dataset.glass).toBe('true')
  })
  it('defaults safely when browser storage is unavailable', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('Storage disabled') } }, dispatchEvent: vi.fn() })
    expect(readAppearance()).toEqual(parseAppearance([]))
    expect(() => updateAppearance({ glass: false })).not.toThrow()
  })
})
