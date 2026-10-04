import { windowsXpTheme } from './windows-xp/theme.ts'

/** Built-in packs are trusted source assets, not executable third-party plugins. */
interface ThemePack {
  readonly id: string
  readonly label: string
  readonly version: string
  readonly stylesheet: string
  readonly colors: Record<'light' | 'dark', Readonly<Record<string, string>>>
  readonly overrides: Record<'light' | 'dark', Readonly<Record<string, string>>>
}

export const themePacks = [windowsXpTheme] as const satisfies readonly ThemePack[]
export const packedPalettes = Object.fromEntries(themePacks.map(pack => [pack.id, pack.colors])) as
  Record<typeof themePacks[number]['id'], typeof themePacks[number]['colors']>
