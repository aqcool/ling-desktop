import { packedPalettes, themePacks } from './packs/index.ts'

/** Portable theme contract. No React, Electron, DOM, DSH or credentials. */
export type LingTheme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export const palettes = [
  { id: 'default', label: '默认' }, { id: 'forest', label: '森林' },
  { id: 'mint', label: '薄荷' }, { id: 'bee', label: '蜜蜂' }, { id: 'parchment', label: '羊皮纸' },
  ...themePacks.map(({ id, label }) => ({ id, label })),
] as const
export type LingPalette = typeof palettes[number]['id']
export interface Appearance {
  mode: LingTheme
  palette: LingPalette
  terminal: 'follow' | 'manual'
  terminalDark: boolean
}
export type WindowAppearance = Pick<Appearance, 'mode' | 'palette'>
export const appearanceKeys = ['ling.theme', 'ling.palette', 'ling.terminal-theme', 'ling.terminal-dark'] as const
export function isPalette(value: unknown): value is LingPalette { return palettes.some(palette => palette.id === value) }
export function parseAppearance(values: readonly (string | null)[]): Appearance {
  const [mode, palette, terminal, terminalDark] = values
  return { mode: mode === 'light' || mode === 'dark' ? mode : 'system', palette: isPalette(palette) ? palette : 'default',
    terminal: terminal === 'manual' ? 'manual' : 'follow', terminalDark: terminalDark === 'true' }
}
export function resolveTheme(mode: LingTheme, systemDark: boolean): ResolvedTheme {
  return mode === 'system' ? systemDark ? 'dark' : 'light' : mode
}
export function terminalMode(appearance: Appearance, resolved: ResolvedTheme): ResolvedTheme {
  return appearance.terminal === 'follow' ? resolved : appearance.terminalDark ? 'dark' : 'light'
}
/** Only these two enum values may cross the native appearance boundary. */
export function parseWindowAppearance(value: unknown): WindowAppearance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { mode, palette } = value as Record<string, unknown>
  return (mode === 'system' || mode === 'light' || mode === 'dark') && isPalette(palette) ? { mode, palette } : undefined
}

export const metrics = {
  'font-ui': 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif',
  'font-code': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'font-size-micro': '10px', 'font-size-caption': '11px', 'font-size-xs': '12px', 'font-size-compact': '13px',
  'font-size-sm': '14px', 'font-size-md': '15px', 'font-size-base': '16px', 'font-size-lg': '18px',
  'font-size-xl': '20px', 'font-size-2xl': '24px', 'font-size-3xl': '28px', 'font-size-4xl': '32px',
  'space-unit': '0.25rem', 'control-xs': '1.5rem', 'control-sm': '1.75rem', 'control-md': '2rem', 'control-lg': '2.25rem',
  'radius': '0.5rem', 'field-radius': 'var(--radius)',
  'corner-xs': 'calc(var(--radius) * 0.25)', 'corner-sm': 'calc(var(--radius) * 0.5)',
  'corner-md': 'calc(var(--radius) * 0.75)', 'corner-lg': 'var(--radius)', 'corner-xl': 'calc(var(--radius) * 1.5)',
  'corner-2xl': 'calc(var(--radius) * 2)', 'corner-3xl': 'calc(var(--radius) * 3)',
  'line-body': '1.5', 'line-copy': '1.75', 'line-chat': '2',
  'disabled-opacity': '0.5', 'border-width': '1px', 'field-border-width': '1px',
} as const

const light: Record<string, string> = {
  "background": "#fafafa",
  "foreground": "#252525",
  "surface": "#ffffff",
  "surface-foreground": "var(--foreground)",
  "surface-secondary": "#f6f6f6",
  "surface-secondary-foreground": "var(--foreground)",
  "surface-tertiary": "#eeeeee",
  "surface-tertiary-foreground": "var(--foreground)",
  "field-background": "#fcfcfc",
  "field-foreground": "var(--foreground)",
  "field-placeholder": "#9b9b9b",
  "accent": "#171717",
  "accent-foreground": "#ffffff",
  "border": "#dcdcdc",
  "separator": "#e6e6e6",
  "muted": "#666666",
  "success": "#27814b",
  "warning": "#906b16",
  "danger": "#b04c43",
  "permission-danger": "#ff4d4f",
  "goal-mode-foreground": "#da5597",
  "goal-mode-background": "#f5e4f2",
  "plan-mode-foreground": "#7cb196",
  "plan-mode-background": "#f0f3f2",
  "skill-tag-foreground": "#3b81e9",
  "skill-tag-background": "#e9f6fe",
  "focus": "#4d735f",
  "sidebar-background": "#f3f1f1",
  "surface-hover": "#eeeded",
  "surface-selected": "#e3e1e1",
  "text-secondary": "#6b6b6b",
  "text-tertiary": "#868686",
  "code-background": "#f6f6f5",
  "panel-border": "#e5e5e5",
  "info": "#345ac0",
  "link": "#4a6fa5",
  "action": "#c96343",
  "action-foreground": "#ffffff",
  "terminal-background": "#ffffff",
  "terminal-foreground": "#252525",
  "overlay-scrim": "#00000059"
}
const dark: Record<string, string> = {
  "goal-mode-foreground": "#f472b6",
  "goal-mode-background": "#3a1d2c",
  "plan-mode-foreground": "#8fc9ae",
  "plan-mode-background": "#1c2e25",
  "background": "#131313",
  "foreground": "#e8e8e8",
  "surface": "#191919",
  "surface-foreground": "var(--foreground)",
  "surface-secondary": "#242424",
  "surface-secondary-foreground": "var(--foreground)",
  "surface-tertiary": "#2e2e2e",
  "surface-tertiary-foreground": "var(--foreground)",
  "field-background": "#202020",
  "field-foreground": "var(--foreground)",
  "field-placeholder": "#808080",
  "accent": "#e8e8e8",
  "accent-foreground": "#131313",
  "border": "#3a3a3a",
  "separator": "#303030",
  "muted": "#989898",
  "surface-hover": "#2b2b2e",
  "sidebar-background": "#1e1e20",
  "surface-selected": "#303034",
  "text-secondary": "#ababab",
  "text-tertiary": "#9e9e9e",
  "code-background": "#202020",
  "panel-border": "#39393d",
  "skill-tag-foreground": "#5ebcff",
  "skill-tag-background": "#1a2838",
  "focus": "#e3977c",
  "success": "#7fd39a",
  "warning": "#e7bb67",
  "danger": "#ef968d",
  "info": "#8ab0e8",
  "link": "#8ab0e8",
  "action": "#e3977c",
  "action-foreground": "#252525",
  "terminal-background": "#1b1b1e",
  "terminal-foreground": "#e8e8e9",
  "overlay-scrim": "#00000080"
}

const tinted: Record<Exclude<LingPalette, 'default'>, Record<ResolvedTheme, Record<string, string>>> = {
  forest: {
    light: {"background": "#eaf9eb", "surface": "#fafefb", "surface-secondary": "#eff8f0", "surface-tertiary": "#e2f1e3", "surface-selected": "#d7ead9", "foreground": "#1e2a20", "text-secondary": "#4f5c50", "text-tertiary": "#6a756b", "panel-border": "#d8e1d9", "focus": "#306d3c"},
    dark: {"background": "#0f1610", "surface": "#171e18", "surface-secondary": "#1d251e", "surface-tertiary": "#232f25", "surface-selected": "#2c3d2e", "foreground": "#e6ede7", "text-secondary": "#a7b6a9", "text-tertiary": "#8d998e", "panel-border": "#334035", "focus": "#84c38d"},
  },
  mint: {
    light: {"background": "#e6f9f3", "surface": "#fafefd", "surface-secondary": "#edf8f5", "surface-tertiary": "#def1eb", "surface-selected": "#d2eae2", "foreground": "#192b25", "text-secondary": "#4a5d57", "text-tertiary": "#667671", "panel-border": "#d6e1dd", "focus": "#056e5a"},
    dark: {"background": "#0c1613", "surface": "#141e1b", "surface-secondary": "#1a2622", "surface-tertiary": "#1f2f2a", "surface-selected": "#243e36", "foreground": "#e3eeea", "text-secondary": "#a2b6b0", "text-tertiary": "#889a94", "panel-border": "#2e403b", "focus": "#6fc4ad"},
  },
  bee: {
    light: {"background": "#fff3da", "surface": "#fffdf7", "surface-secondary": "#fcf5e6", "surface-tertiary": "#f7ebd2", "surface-selected": "#f2e2c2", "foreground": "#2c2618", "text-secondary": "#5e5748", "text-tertiary": "#777165", "panel-border": "#e4ddcf", "focus": "#7a5700"},
    dark: {"background": "#17130b", "surface": "#1f1b13", "surface-secondary": "#272219", "surface-tertiary": "#312b1e", "surface-selected": "#403723", "foreground": "#efebe2", "text-secondary": "#b8b0a0", "text-tertiary": "#9b9486", "panel-border": "#423b2d", "focus": "#d1ac5a"},
  },
  parchment: {
    light: {"background": "#fff2e0", "surface": "#fffdf8", "surface-secondary": "#fcf4e9", "surface-tertiary": "#f7ead8", "surface-selected": "#f3e1ca", "foreground": "#2e2519", "text-secondary": "#605649", "text-tertiary": "#797065", "panel-border": "#e5ddd2", "focus": "#75582e"},
    dark: {"background": "#18130b", "surface": "#201b13", "surface-secondary": "#282219", "surface-tertiary": "#322a1e", "surface-selected": "#433523", "foreground": "#f0eae3", "text-secondary": "#baafa1", "text-tertiary": "#9d9487", "panel-border": "#443a2d", "focus": "#ccab7f"},
  },
  ...packedPalettes,
}

/** Every consumer gets the same complete semantic palette, including status and terminal colors. */
export function themeTokens(mode: ResolvedTheme, palette: LingPalette = 'default', resolveReferences = true): Record<string, string> {
  const tokens: Record<string, string> = { ...metrics, ...light, ...(mode === 'dark' ? dark : {}) }
  if (palette !== 'default') Object.assign(tokens, tinted[palette][mode], {
    'sidebar-background': 'var(--background)', 'surface-hover': 'var(--surface-tertiary)',
    'border': 'var(--panel-border)', 'separator': 'var(--panel-border)', 'code-background': 'var(--surface-secondary)',
    'field-background': 'var(--surface)', 'field-placeholder': 'var(--text-tertiary)', 'muted': 'var(--text-secondary)',
    'accent': 'var(--focus)', 'accent-foreground': mode === 'dark' ? 'var(--background)' : '#ffffff',
    'action': 'var(--accent)', 'action-foreground': 'var(--accent-foreground)',
    'terminal-background': 'var(--surface)', 'terminal-foreground': 'var(--foreground)',
  })
  Object.assign(tokens, {
    'overlay': 'var(--surface)', 'overlay-foreground': 'var(--foreground)',
    'default': 'var(--surface-tertiary)', 'default-foreground': 'var(--foreground)',
    'segment': 'var(--surface)', 'segment-foreground': 'var(--foreground)',
    'field-border': 'var(--panel-border)', 'disabled-foreground': 'var(--text-tertiary)',
    'disabled-background': 'var(--surface-tertiary)', 'success-foreground': mode === 'dark' ? '#17221a' : '#ffffff',
    'warning-foreground': mode === 'dark' ? '#2c2213' : '#ffffff', 'danger-foreground': mode === 'dark' ? '#301a19' : '#ffffff',
    'permission-danger': 'var(--danger)',
    'success-subtle': mode === 'dark' ? '#17301f' : '#eaf7ee', 'danger-subtle': mode === 'dark' ? '#33191a' : '#fdf0ee',
    'warning-subtle': mode === 'dark' ? '#352c1d' : '#faf1df', 'info-subtle': mode === 'dark' ? '#24364f' : '#e6f2ff',
    'on-strong-border': '#ffffff33', 'on-strong-surface': '#ffffff14', 'browser-canvas': '#ffffff',
    'on-strong': '#f4f4f2', 'on-strong-muted': '#c9c9c4', 'strong-background': '#252525',
    'terminal-selection': mode === 'dark' ? '#ffffff35' : '#00000025',
    'shadow-color': mode === 'dark' ? '#00000060' : '#00000020',
    'surface-shadow': '0 1px 3px var(--shadow-color)', 'overlay-shadow': '0 12px 32px var(--shadow-color)',
    'field-shadow': '0 1px 2px var(--shadow-color)',
  })
  const pack = themePacks.find(pack => pack.id === palette)
  if (pack) Object.assign(tokens, pack.overrides[mode])
  const inverse = { ...light, ...dark, ...(palette === 'default' ? {} : tinted[palette].dark) }
  for (const key of ['surface', 'surface-secondary', 'surface-tertiary', 'foreground', 'text-secondary', 'panel-border', 'link']) {
    tokens[`inverse-${key}`] = inverse[key]!
  }
  if (!resolveReferences) return tokens
  // Fully resolve aliases once. Native windows and xterm cannot consume CSS var() values.
  const resolve = (key: string, seen = new Set<string>()): string => {
    if (seen.has(key)) throw new Error(`Circular theme token: ${key}`)
    const value = tokens[key]
    if (value === undefined) throw new Error(`Missing theme token: ${key}`)
    seen.add(key)
    return value.replace(/var\(--([\w-]+)\)/g, (_, dependency: string) => resolve(dependency, new Set(seen)))
  }
  return Object.fromEntries(Object.keys(tokens).map(key => [key, resolve(key)]))
}

export function themeStylesheet(): string {
  return palettes.flatMap(({ id }) => (['light', 'dark'] as const).map(mode => {
    const selector = `${id === 'default' && mode === 'light' ? ':root,' : ''}[data-theme="${mode}"][data-palette="${id}"]`
    return `${selector}{color-scheme:${mode};${Object.entries(themeTokens(mode, id, false)).map(([key, value]) => `--${key}:${value};`).join('')}}`
  })).join('\n')
}

export function terminalTheme(mode: ResolvedTheme, palette: LingPalette) {
  const t = themeTokens(mode, palette)
  const dark = mode === 'dark'
  return {
    background: t['terminal-background']!, foreground: t['terminal-foreground']!, cursor: t['terminal-foreground']!,
    cursorAccent: t['terminal-background']!, selectionBackground: t['terminal-selection']!,
    black: dark ? '#34343a' : '#252525', red: t.danger!, green: t.success!, yellow: t.warning!, blue: t.info!,
    magenta: dark ? '#c99fea' : '#8755ad', cyan: dark ? '#75c4c9' : '#177e85', white: dark ? '#d8d8dc' : '#777777',
    brightBlack: dark ? '#85858c' : '#555555', brightRed: t.danger!, brightGreen: t.success!, brightYellow: t.warning!,
    brightBlue: t.info!, brightMagenta: dark ? '#deb6fa' : '#8755ad', brightCyan: dark ? '#94e3e8' : '#177e85',
    brightWhite: dark ? '#ffffff' : '#555555',
  }
}
