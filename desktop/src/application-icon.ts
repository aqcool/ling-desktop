import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const applicationIconStyles = ['fold-coral', 'fold-indigo', 'relay-dark', 'relay-light'] as const
export type ApplicationIconStyle = typeof applicationIconStyles[number]
export interface ApplicationIconSnapshot {
  readonly style: ApplicationIconStyle
  readonly styles: readonly ApplicationIconStyle[]
}

export function parseApplicationIconStyle(value: unknown): ApplicationIconStyle {
  if (typeof value !== 'string' || !(applicationIconStyles as readonly string[]).includes(value)) {
    throw new Error('不支持的应用图标。')
  }
  return value as ApplicationIconStyle
}

export interface ApplicationIconStore {
  read(): Promise<ApplicationIconStyle>
  write(style: ApplicationIconStyle): Promise<void>
}

/** The native Host owns this preference; renderer storage is only a projection. */
export class FileApplicationIconStore implements ApplicationIconStore {
  constructor(private readonly file: string) {}

  async read(): Promise<ApplicationIconStyle> {
    try {
      const document: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!document || typeof document !== 'object' || Array.isArray(document)
        || !('version' in document) || document.version !== 1 || !('style' in document)) {
        throw new Error('Invalid application icon preference')
      }
      const legacy: Record<string, ApplicationIconStyle> = { default: 'fold-indigo', dark: 'relay-dark', gradient: 'relay-light' }
      const migrated = typeof document.style === 'string' && Object.hasOwn(legacy, document.style) ? legacy[document.style] : undefined
      const style = migrated ?? parseApplicationIconStyle(document.style)
      if (migrated) await this.write(style)
      return style
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 'fold-indigo'
      throw new Error('应用图标偏好无法读取，请重新选择图标。', { cause: error })
    }
  }

  async write(style: ApplicationIconStyle): Promise<void> {
    parseApplicationIconStyle(style)
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = join(dirname(this.file), `.application-icon-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify({ version: 1, style })}\n`, 'utf8')
        await handle.sync()
      } finally { await handle.close() }
      await rename(temporary, this.file)
    } finally { await rm(temporary, { force: true }) }
  }
}

/** Applies each selection before acknowledging it and rolls back failed saves. */
export class ApplicationIconController {
  private style: ApplicationIconStyle = 'fold-indigo'
  private stored = false
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: ApplicationIconStore, private readonly apply: (style: ApplicationIconStyle) => void) {}

  snapshot(): ApplicationIconSnapshot { return { style: this.style, styles: [...applicationIconStyles] } }

  async restore(): Promise<ApplicationIconSnapshot> {
    // Keep the default usable even if an older preference file is damaged.
    this.apply('fold-indigo')
    const restored = await this.store.read()
    if (restored !== 'fold-indigo') this.apply(restored)
    this.style = restored
    this.stored = true
    return this.snapshot()
  }

  set(raw: unknown): Promise<ApplicationIconSnapshot> {
    const style = parseApplicationIconStyle(raw)
    const result = this.pending.then(async () => {
      if (style === this.style && this.stored) return this.snapshot()
      const previous = this.style
      let applied = false
      try {
        this.apply(style)
        applied = true
        await this.store.write(style)
      } catch (error) {
        try { this.apply(previous) }
        catch (rollbackError) {
          throw new Error('应用图标切换失败，且无法恢复原图标，请重新启动灵创。', { cause: rollbackError })
        }
        throw new Error(applied ? '应用图标未能保存，已恢复原图标，请重试。' : '系统无法更新应用图标，已恢复原图标，请重试。', { cause: error })
      }
      this.style = style
      this.stored = true
      return this.snapshot()
    })
    this.pending = result.catch(() => undefined)
    return result
  }
}

/** Only running application surfaces change; installed package identity is fixed. */
export function applyNativeApplicationIcon<Image>(platform: NodeJS.Platform, image: Image, surfaces: {
  readonly dock?: { setIcon(image: Image): void }
  readonly windows: readonly { isDestroyed(): boolean; setIcon(image: Image): void }[]
}): void {
  if (platform === 'darwin') {
    if (!surfaces.dock) throw new Error('系统程序坞不可用。')
    surfaces.dock.setIcon(image)
    return
  }
  if (platform !== 'win32' && platform !== 'linux') throw new Error('当前系统不支持应用图标切换。')
  for (const window of surfaces.windows) if (!window.isDestroyed()) window.setIcon(image)
}
