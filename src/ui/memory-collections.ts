import type {
  KnowledgeDocument,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
import type { KnowledgeScopeInput } from './useKnowledge.js'

export function memoryDocuments(documents: readonly KnowledgeDocument[]) {
  return documents.filter(
    (doc) => doc.kind === 'memory' && doc.state !== 'archived',
  )
}

/** Delete only the memories reviewed by the user, with their original versions. */
export async function clearMemoryCollection(
  service: LingKnowledgeService,
  scope: KnowledgeScopeInput,
  documents: readonly KnowledgeDocument[],
  signal: AbortSignal,
) {
  for (const doc of memoryDocuments(documents)) {
    signal.throwIfAborted()
    const result = await service.request(
      { ...scope, type: 'remove', id: doc.id, version: doc.version },
      signal,
    )
    if (!result.ok)
      throw new Error(result.message ?? '记忆未能清空，请刷新后重试。')
  }
}
