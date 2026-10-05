// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OfficePreview } from '../src/ui/OfficePreview.js'
import type { OfficeViewer } from '../src/office/viewer.js'

const harness = vi.hoisted(() => ({ mount: vi.fn() }))
vi.mock('../src/office/viewer.js', () => ({ mountOfficeViewer: harness.mount }))
let root: Root, container: HTMLDivElement
const doc = (path: string) => ({ path, kind: 'office' as const, mediaType: 'application/octet-stream', data: 'AA==' })
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  harness.mount.mockReset()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
const show = async (path: string) => { await act(async () => root.render(<OfficePreview document={doc(path)} />)) }

it('cancels a previous file, disposes late results and keeps the new preview intact', async () => {
  let finish!: (viewer: OfficeViewer) => void
  const previous = { dispose: vi.fn(), warnings: ['旧文件提示'] }, current = { dispose: vi.fn(), warnings: [] }
  harness.mount.mockImplementationOnce(() => new Promise<OfficeViewer>(resolve => { finish = resolve })).mockResolvedValueOnce(current)
  await show('first.docx'); const signal = harness.mount.mock.calls[0]![3] as AbortSignal
  await show('second.xlsx')
  expect(signal.aborted).toBe(true)
  await act(async () => finish(previous))
  expect(previous.dispose).toHaveBeenCalledOnce()
  expect(container.textContent).not.toContain('旧文件提示')
  expect(container.querySelector('[role=status]')).toBeNull()
  await act(async () => root.unmount())
  expect(current.dispose).toHaveBeenCalledOnce()
})

it('offers a working retry after initialization fails', async () => {
  harness.mount.mockRejectedValueOnce(new Error('文档损坏')).mockResolvedValueOnce({ dispose: vi.fn(), warnings: [] })
  await show('broken.pptx')
  expect(container.querySelector('[role=alert]')?.textContent).toContain('文档损坏')
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
  expect(harness.mount).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[role=alert]')).toBeNull()
})
