// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { pollKnowledge } from '../src/ui/knowledge-polling.js'
import { useKnowledge } from '../src/ui/useKnowledge.js'
import { knowledgeDefaults, type LingKnowledgeService } from '../src/runtime/knowledge.js'
let root: Root | undefined
const cleanup: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; for (const dispose of cleanup.splice(0)) dispose(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('knowledge refresh scheduling', () => {
  it('backs off while idle, accelerates during jobs, pauses while hidden and resumes on focus', async () => {
    let hidden = false, running = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    const load = vi.fn(async () => running)
    cleanup.push(pollKnowledge(load))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(29999); expect(load).toHaveBeenCalledTimes(1)
    running = true; await vi.advanceTimersByTimeAsync(1); expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000); expect(load).toHaveBeenCalledTimes(3)
    hidden = true; document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60000); expect(load).toHaveBeenCalledTimes(3)
    hidden = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(4)
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); expect(load).toHaveBeenCalledTimes(5)
  })
  it('never overlaps refresh requests and aborts the pending read on disposal', async () => {
    let finish!: (active: boolean) => void
    const load = vi.fn((_signal: AbortSignal) => new Promise<boolean>(resolve => { finish = resolve }))
    const dispose = pollKnowledge(load); cleanup.push(dispose)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(load).toHaveBeenCalledTimes(1)
    dispose(); expect(load.mock.calls[0]![0].aborted).toBe(true)
    finish(true); await vi.advanceTimersByTimeAsync(60000); expect(load).toHaveBeenCalledTimes(1)
  })
  it('uses conditional snapshots without erasing the loaded document or crossing scope revisions', async () => {
    const request = vi.fn<LingKnowledgeService['request']>(async input => ({ ok: true, value: input.type !== 'snapshot' ? {} : input.revision ? { revision: 'a-revision', unchanged: true } : { revision: `${input.workspaceId}-revision`, snapshot: { documents: [], jobs: [], indexedFiles: input.workspaceId === 'a' ? 8 : 3, indexedAt: 1, settings: knowledgeDefaults } } }))
    // Keep the service identity stable, as in the runtime adapter.
    const service = { request }
    function StableProbe({ scope }: { scope: string }) { const { snapshot } = useKnowledge(service, { workspaceId: scope }); return <span>{snapshot?.indexedFiles}</span> }
    const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => root!.render(<StableProbe scope="a" />))
    expect(container.textContent).toBe('8')
    await act(async () => vi.advanceTimersByTimeAsync(30000))
    expect(request).toHaveBeenLastCalledWith({ type: 'snapshot', workspaceId: 'a', revision: 'a-revision' }, expect.any(AbortSignal))
    expect(container.textContent).toBe('8')
    await act(async () => root!.render(<StableProbe scope="b" />))
    expect(request).toHaveBeenLastCalledWith({ type: 'snapshot', workspaceId: 'b' }, expect.any(AbortSignal))
    expect(container.textContent).toBe('3')
  })
  it('keeps the active refresh interval after a reload returns an unchanged snapshot', async () => {
    const request = vi.fn<LingKnowledgeService['request']>(async input => ({ ok: true, value: input.type !== 'snapshot' ? {} : input.revision ? { revision: 'active', unchanged: true } : { revision: 'active', snapshot: { documents: [], jobs: [{ id: 'job', scope: 'a', kind: 'wiki', status: 'running', createdAt: 1, updatedAt: 1 }], indexedFiles: 3, indexedAt: 1, settings: knowledgeDefaults } } }))
    const service = { request }
    function Probe() { const { reload } = useKnowledge(service, { workspaceId: 'a' }); return <button onClick={reload}>刷新</button> }
    const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
    await act(async () => root!.render(<Probe />))
    await act(async () => container.querySelector('button')!.click())
    expect(request).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(request).toHaveBeenCalledTimes(3)
  })
})
