import { constants } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { CatalogCacheEntry } from './model-catalog.ts'

const model = z.object({ id: z.string().min(1).max(1024), name: z.string().optional(), contextWindow: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional(), input: z.array(z.enum(['text', 'image'])).optional(), efforts: z.array(z.string()).optional(), reasoningEfforts: z.record(z.string(), z.string().nullable()).optional(), systemPromptUpdate: z.enum(['leading-only', 'in-history']).optional(), conversational: z.boolean() }).strict()
const metadata = z.object({ name: z.string().optional(), contextWindow: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional(), input: z.array(z.enum(['text', 'image'])).optional(), inputModalities: z.array(z.enum(['text', 'image'])).optional(), systemPromptUpdate: z.enum(['leading-only', 'in-history']).optional(), reasoning: z.boolean().optional(), reasoningEfforts: z.record(z.string(), z.string().nullable()).optional() }).strict()
const entry = z.object({ identity: z.string().regex(/^[a-f0-9]{64}$/), updatedAt: z.number().positive(), models: z.array(model).max(10000), newModelIds: z.array(z.string()), pending: z.boolean(), generated: z.record(z.string(), metadata) }).strict()
const cacheSchema = z.object({ version: z.literal(1), providers: z.record(z.string(), entry) }).strict()

/** Only endpoint metadata and generated-field ownership are persisted, never profile secrets. */
export class ModelCatalogStore {
  private entries: Record<string, CatalogCacheEntry> = Object.create(null)
  private tail: Promise<void> = Promise.resolve()
  readonly ready: Promise<void>
  constructor(private readonly home: string) {
    this.ready = this.load()
  }
  private async load(): Promise<void> {
    try {
      const file = await open(join(this.home, 'ling-model-catalog.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if ((await file.stat()).size > 32 * 1024 * 1024) return
        const parsed = cacheSchema.safeParse(JSON.parse(await file.readFile('utf8')))
        if (parsed.success) this.entries = Object.assign(Object.create(null), parsed.data.providers)
      } finally { await file.close() }
    } catch { /* A missing/corrupt cache never prevents the bundled runtime from starting. */ }
  }
  get(providerId: string): CatalogCacheEntry | undefined { return this.entries[providerId] }
  save(providerId: string, value: CatalogCacheEntry): Promise<void> {
    const validated = entry.parse(value)
    const write = this.tail.then(async () => {
      await this.ready
      const next = { ...this.entries, [providerId]: validated }
      await mkdir(this.home, { recursive: true, mode: 0o700 })
      const path = join(this.home, 'ling-model-catalog.json'), temporary = `${path}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify({ version: 1, providers: next })); await handle.sync() } finally { await handle.close() }
        await rename(temporary, path)
        this.entries = Object.assign(Object.create(null), next)
      } finally { await rm(temporary, { force: true }) }
    })
    this.tail = write.catch(() => {})
    return write
  }
  async settled(): Promise<void> { await this.tail }
}
