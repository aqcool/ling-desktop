import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LingPresentedFile } from 'ling-desktop/runtime'

export function presentedFiles(seq: number, data: unknown): { turn: number; files: LingPresentedFile[] } | undefined {
  if (!data || typeof data !== 'object') return
  const value = data as Record<string, unknown>
  if (!Number.isSafeInteger(value.turn) || Number(value.turn) < 1 || !Array.isArray(value.files)) return
  const files = value.files.flatMap((entry: unknown, index: number): LingPresentedFile[] => {
    if (!entry || typeof entry !== 'object') return []
    const file = entry as Record<string, unknown>
    if (typeof file.path !== 'string' || !file.path.trim() || file.path.includes('\0')) return []
    return [{ seq, index, path: file.path, ...(typeof file.description === 'string' ? { description: file.description } : {}) }]
  })
  return files.length ? { turn: Number(value.turn), files } : undefined
}

/** Keep durable deliveries visible even when there is no closing assistant text. */
export const lingDeliverablesDefinition: ConversationNodeDefinition = {
  kind: 'ling-deliverables', target: 'chat',
  match(event) {
    return (event.type as string) === 'deliverables/presented' && presentedFiles(event.seq, event.data)
      ? { id: String(event.seq), role: 'start' } : null
  },
  start: () => ({}), update: () => ({}),
  buildViewNode(context) {
    const match = context.matches[0]
    if (!match) return null
    const data = presentedFiles(match.event.seq, match.event.data)
    if (!data) return null
    return { key: context.key, id: context.id, kind: 'ling-deliverables', target: 'chat',
      anchorSeq: match.event.seq, location: match.location, visibility: 'visible', data: { ...data, time: match.event.time } }
  },
}
