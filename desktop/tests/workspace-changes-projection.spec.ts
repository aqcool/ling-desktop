import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { describe, expect, it, vi } from 'vitest'
import { createDshWorkspaceChangesProjection, lingWorkspaceChangesDefinition } from '../src/client/workspace-changes-projection.js'

function chatSnapshot(seq = 8): ChatSnapshot {
  return {
    nodes: { values: () => [] },
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
  it('uses the LING durable Remote and propagates missing/error results without guessing counts', async () => {
    const fetcher = vi.fn()
    const remote = { summary: vi.fn(async () => ({ ok: true as const, value: { turn: 1, workspacePath: '/workspace', files: [], total: 0, added: 0, deleted: 0 } })),
      diff: vi.fn(async () => ({ ok: true as const, value: null })) }
    const projection = createDshWorkspaceChangesProjection({ binding: () => ({ target: () => ({ getSnapshot: () => chatSnapshot() }) }) } as never, fetcher, async () => remote)
    const signal = new AbortController().signal
    expect(await projection.list(binding(), signal)).toMatchObject([{ turn: 1, seq: 8, workspacePath: '/workspace' }])
    expect(remote.summary).toHaveBeenCalledWith({ taskId: 'session-1', seq: 8 }, signal)
    expect(await projection.diff(binding(), 8, 0, signal)).toBeUndefined()
    remote.summary.mockResolvedValueOnce({ ok: false, error: { message: 'storage unavailable' } } as never)
    await expect(projection.list(binding(), signal)).rejects.toThrow('storage unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('owns workspace announcements even when no upstream UI definition is mounted', async () => {
    const event = { seq: 8, type: 'workspace/changes', data: { turn: 1 } }
    expect(lingWorkspaceChangesDefinition.match(event as never)).toEqual({ id: '8', role: 'start' })
    expect(lingWorkspaceChangesDefinition.match({ ...event, data: { turn: -1 } } as never)).toBeNull()
    const node = lingWorkspaceChangesDefinition.buildViewNode!({ key: 'changes:8', id: '8', matches: [{ event }], location: { kind: 'session' } } as never)
    expect(node).toMatchObject({ kind: 'ling-workspace-changes', anchorSeq: 8, data: { turn: 1, seq: 8 } })
    const snapshot = chatSnapshot()
    const projection = createDshWorkspaceChangesProjection({ binding: () => ({ target: () => ({ getSnapshot: () => ({ ...snapshot, timeline: { ...snapshot.timeline, turns: new Map() }, nodes: { values: () => [node] } }) }) }) } as never,
      vi.fn(async () => new Response(JSON.stringify({ turn: 1, files: [], total: 0, added: 0, deleted: 0 }))) as typeof fetch)
    await expect(projection.list(binding(), new AbortController().signal)).resolves.toMatchObject([{ seq: 8, turn: 1 }])
  })

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

  it('accepts the zero-line side of an added or deleted file', async () => {
    const projection = createDshWorkspaceChangesProjection({} as never,
      vi.fn(async () => new Response(JSON.stringify({ kind: 'text', path: 'new.ts', display: 'new.ts', before: false, after: true, coarse: false,
        hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+export {}'] }] }))) as typeof fetch)
    await expect(projection.diff(binding(), 8, 0, new AbortController().signal)).resolves.toMatchObject({ hunks: [{ oldStart: 0 }] })
  })
})
