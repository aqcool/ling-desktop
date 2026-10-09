// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingEvolutionService, LingEvolutionSuggestion } from '../src/runtime/evolution.js'
import { EvolutionSuggestionList, TaskSkills } from '../src/ui/TaskSkills.js'

const suggestion: LingEvolutionSuggestion = {
  id: 'proposal', name: 'macos-finder-sync', description: '从已验证的任务流程提炼 Finder Sync 扩展发布步骤。',
  version: 3, createdAt: 1, source: { taskId: 'task', throughSeq: 12, seqs: [3, 9] },
}
let root: Root | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers()
})
async function mount(element: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(element))
  return container
}

describe('self-evolution entry and actions', () => {
  it('shows a genuine suggestion count beside candidates and actual usage without reading the available catalog', async () => {
    const service: LingEvolutionService = { list: vi.fn(async () => ({ ok: true as const, value: [suggestion] })), create: vi.fn(), ignore: vi.fn() }
    const container = await mount(<TaskSkills service={service} taskId="task" resources={[{ id: 'skill:frontend-design', kind: 'skill', name: 'frontend-design', taskId: 'task', itemId: 'used' }]} />)
    expect(container.textContent).toContain('技能与 MCP')
    expect(container.textContent).toContain('1条建议')
    expect(container.textContent).toContain('macos-finder-sync')
    expect(container.textContent).toContain('frontend-design')
    expect(container.textContent).not.toContain('可用')
    expect(service.list).toHaveBeenCalledWith('task', expect.any(AbortSignal))
    expect(service.create).not.toHaveBeenCalled(); expect(service.ignore).not.toHaveBeenCalled()
  })

  it('keeps create and ignore separate and disables both while the host is working', async () => {
    const onAction = vi.fn()
    const container = await mount(<EvolutionSuggestionList suggestions={[suggestion]} onAction={onAction} />)
    const buttons = container.querySelectorAll<HTMLButtonElement>('button')
    await act(async () => buttons[0]!.click())
    expect(onAction).toHaveBeenLastCalledWith(suggestion, 'create')
    await act(async () => buttons[1]!.click())
    expect(onAction).toHaveBeenLastCalledWith(suggestion, 'ignore')
    await act(async () => root!.render(<EvolutionSuggestionList suggestions={[suggestion]} onAction={onAction} busy={{ id: suggestion.id, action: 'create' }} message="同名技能已经存在" />))
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every(button => button.disabled)).toBe(true)
    expect(container.textContent).toContain('创建中…')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('同名技能已经存在')
  })

  it('does not invent proposals when only task usage exists or the service is unavailable', async () => {
    const container = await mount(<TaskSkills taskId="task" resources={[{ id: 'mcp:test', kind: 'mcp', name: 'test__fetch', taskId: 'task', itemId: 'call' }]} />)
    expect(container.textContent).toContain('test__fetch')
    expect(container.textContent).not.toContain('条建议')
    await act(async () => root!.render(<TaskSkills taskId="task" resources={[]} />))
    expect(container.textContent).toBe('')
  })
})
