import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-settings'
import { compactionNamespace, validateCompactionPreferences, type LingCompactionPreferences } from 'ling-desktop/runtime'

export const name = 'ling-compaction'
export const inject = ['settings', 'loader']

/** Apply a boot-time policy to the published engine in each preset's own realm. */
export function apply(ctx: Context): void {
  const scope = ctx.settings.register(compactionNamespace, Schema.object({
    auto: Schema.boolean().default(true),
    thresholdRatio: Schema.number().min(0.01).max(0.99).default(0.8),
    retainRatio: Schema.number().min(0).max(0.98).default(0.16),
    summarizationProvider: Schema.string().default(''),
    summarizationModel: Schema.string().default(''),
  }), { applies: 'restart', validate: validateCompactionPreferences })
  // Resolve/validate once now; saved changes take effect at the next Host boot.
  scope.get()
  const user = { ...ctx.settings.describe().find(view => view.ns === compactionNamespace)?.user as Partial<LingCompactionPreferences> | undefined }
  // PresetTree never writes its runtime entries back to the source composition.
  // Keep the service isolated, including the pruner and /compact in that realm.
  ctx.on('loader/patch-context', async (entry, next) => {
    if (entry.options.name === '@deepseek-ai/dsh-compaction-basic' && scopeOf(entry.parent.ctx)) {
      const base = entry.options.config as BasicCompactionConfig | undefined
      const config: BasicCompactionConfig = { ...base, ...user }
      if (base?.retainTokens !== undefined && !Object.hasOwn(user, 'retainRatio')) delete config.retainRatio
      else delete config.retainTokens
      entry.options.config = config
    }
    await next()
  })
}
