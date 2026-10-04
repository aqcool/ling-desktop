// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Composer } from '../src/ui/Composer.js'
import { toComposerWorkspaceContext } from '../src/ui/attachments.js'

let root: Root | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it('removes workspace context through the existing draft callback and allows context-only sending', async () => {
  const directory = toComposerWorkspaceContext({ kind: 'directory', path: '/work/src/components' })
  const file = toComposerWorkspaceContext({ kind: 'file', path: '/work/src/main.ts' })
  const selection = toComposerWorkspaceContext({ kind: 'selection', path: '/work/src/main.ts', text: 'const n = 1', startLine: 8, endLine: 8 })
  const remove = vi.fn()
  const removeRecorded = vi.fn()
  const submit = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(<Composer
    value="" attachments={[directory, file, selection]} running={false} hasTask disabled={false} modelLabel="DeepSeek" taskScoped={false}
    onChange={() => {}} onAddFiles={() => {}} onRemoveAttachment={remove} onRemoveRecordedAttachment={removeRecorded}
    onSubmit={submit} onStop={() => {}} onSelectModel={() => {}} onOpenModelSettings={() => {}}
    onSelectPermission={() => {}} onPlanModeToggle={() => {}} onGoalAction={() => {}}
  />) })

  const send = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
  expect(send?.disabled).toBe(false)
  await act(async () => { send!.click() })
  expect(submit).toHaveBeenCalledOnce()
  for (const context of [directory, file, selection]) {
    const removeButton = container.querySelector<HTMLButtonElement>(`[data-context-kind="${context.context!.kind}"] button`)
    expect(removeButton).not.toBeNull()
    await act(async () => { removeButton!.click() })
    expect(remove).toHaveBeenLastCalledWith(context.id)
  }
  expect(remove).toHaveBeenCalledTimes(3)
  expect(removeRecorded).not.toHaveBeenCalled()
})
