import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { describe, expect, it, vi } from 'vitest'
import { createDshWorkspaceChangesProjection } from '../src/client/workspace-changes-projection.js'

function chatSnapshot(seq = 8): ChatSnapshot {
  return {
    timeline: {
      turnOrder: [1],
      turns: new Map([[1, {
        turn: 1,
        start: undefined,
        end: undefined,
        status: 'closed',
        steps: [],
        data: {
          get: (key: string) => key === 'deliverables' ? { produced: [], changes: { seq } } : undefined,
          source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
        },
      }]]),
    },
  } as unknown as ChatSnapshot
}

function binding() {
  return { sessionId: 'session-1' } as never
}

describe('DSH workspace changes projection', () => {
  it('reads announced turn summaries from the authenticated host route', async () => {
    const signal = new AbortController().signal
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      turn: 1,
      files: [{ path: 'src/app.ts', display: 'src/app.ts', added: 3, deleted: 1 }],
      total: 1,
      added: 3,
      deleted: 1,
    }), { status: 200 }))
    const projection = createDshWorkspaceChangesProjection({
      binding: () => ({
        target: () => ({ getSnapshot: () => chatSnapshot(), subscribe: () => () => {} }),
      }),
    } as never, fetcher as typeof fetch)

    await expect(projection.list(binding(), signal)).resolves.toEqual([{
      taskId: 'session-1',
      turn: 1,
      seq: 8,
      files: [{ path: 'src/app.ts', display: 'src/app.ts', added: 3, deleted: 1 }],
      total: 1,
      added: 3,
      deleted: 1,
    }])
    expect(fetcher).toHaveBeenCalledWith(
      '/api/changes.summary?sessionId=session-1&seq=8',
      { signal },
    )
  })

  it('validates and returns text file comparisons', async () => {
    const signal = new AbortController().signal
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      kind: 'text',
      path: 'src/app.ts',
      display: 'src/app.ts',
      before: true,
      after: true,
      hunks: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: ['-old', '+new'],
      }],
      coarse: false,
    }), { status: 200 }))
    const projection = createDshWorkspaceChangesProjection({} as never, fetcher as typeof fetch)

    await expect(projection.diff(binding(), 8, 0, signal)).resolves.toMatchObject({
      kind: 'text',
      display: 'src/app.ts',
      hunks: [{ oldStart: 1, newStart: 1 }],
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/changes.diff?sessionId=session-1&seq=8&index=0',
      { signal },
    )
  })

  it('does not expose missing or malformed host data', async () => {
    const missing = createDshWorkspaceChangesProjection(
      {} as never,
      vi.fn(async () => new Response('', { status: 404 })) as typeof fetch,
    )
    await expect(missing.diff(binding(), 8, 0, new AbortController().signal)).resolves.toBeUndefined()

    const malformed = createDshWorkspaceChangesProjection(
      {} as never,
      vi.fn(async () => new Response(JSON.stringify({ kind: 'text' }), { status: 200 })) as typeof fetch,
    )
    await expect(malformed.diff(binding(), 8, 0, new AbortController().signal))
      .rejects.toThrow('Invalid changes diff response')
  })
})
