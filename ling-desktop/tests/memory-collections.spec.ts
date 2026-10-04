import { describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeDocument,
  LingKnowledgeService,
} from '../src/runtime/knowledge.js'
import {
  clearMemoryCollection,
  memoryDocuments,
} from '../src/ui/memory-collections.js'

const memory: KnowledgeDocument = {
  id: 'm',
  scope: 'project:a',
  kind: 'memory',
  title: 'Rule',
  body: 'Use the existing tests.',
  state: 'active',
  version: 3,
  manual: true,
  updatedAt: 100,
  sources: [],
}

describe('memory collection management', () => {
  it('counts confirmed, pending and stale memories without mixing Wiki, summaries or archived entries', () => {
    const docs = [
      memory,
      { ...memory, id: 'pending', state: 'candidate' as const },
      { ...memory, id: 'stale', state: 'stale' as const },
      { ...memory, id: 'wiki', kind: 'wiki' as const },
      { ...memory, id: 'summary', kind: 'summary' as const },
      { ...memory, id: 'old', state: 'archived' as const },
    ]
    expect(memoryDocuments(docs).map((doc) => doc.id)).toEqual([
      'm',
      'pending',
      'stale',
    ])
  })
  it('clears only the reviewed memories in the selected scope, with concurrency versions', async () => {
    const request = vi
      .fn<LingKnowledgeService['request']>()
      .mockResolvedValue({ ok: true, value: {} })
    const signal = new AbortController().signal
    await clearMemoryCollection(
      { request },
      { workspaceId: 'a' },
      [
        memory,
        { ...memory, kind: 'wiki', id: 'wiki' },
        { ...memory, kind: 'summary', id: 'summary' },
      ],
      signal,
    )
    expect(request.mock.calls).toEqual([
      [{ type: 'remove', workspaceId: 'a', id: 'm', version: 3 }, signal],
    ])
  })
  it('stops at a changed record instead of continuing to clear stale versions', async () => {
    const request = vi
      .fn<LingKnowledgeService['request']>()
      .mockResolvedValue({
        ok: false,
        reason: 'settings-conflict',
        message: '内容已更新',
        retryable: true,
      })
    await expect(
      clearMemoryCollection(
        { request },
        { workspaceId: null, taskId: 'ssh-task' },
        [memory, { ...memory, id: 'next' }],
        new AbortController().signal,
      ),
    ).rejects.toThrow('内容已更新')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]![0]).toMatchObject({
      workspaceId: null,
      taskId: 'ssh-task',
      version: 3,
    })
  })
  it('does not issue deletion requests after leaving the settings scope', async () => {
    const request = vi.fn<LingKnowledgeService['request']>()
    const controller = new AbortController()
    controller.abort()
    await expect(
      clearMemoryCollection(
        { request },
        { workspaceId: null },
        [memory],
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
