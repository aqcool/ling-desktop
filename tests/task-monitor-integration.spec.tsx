// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel } from '../src/ui/shell/TaskMonitor.js'
import { browserNavigationEvent } from '../src/ui/browser-navigation.js'
import { defaultMonitorPreferences } from '../src/ui/monitor-preferences.js'
import { openTaskNotesEvent } from '../src/ui/TaskNotes.js'

type PanelProps = ComponentProps<typeof EnvironmentPanel>
const selectedTask = { taskId: 'task', title: 'Task', status: 'completed' as const, archived: false, updatedAt: '2026-10-08' }
let root: Root | undefined
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {}; unobserve() {}; disconnect() {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderPanel(overrides: Partial<PanelProps> = {}) {
  await act(async () => root!.render(<EnvironmentPanel {...{
    preferences: defaultMonitorPreferences, presentation: 'fixed', sideChats: [], workspaces: [], timeline: [], changes: [],
    backgroundJobs: [], selectedTask, prompt: '', onPromptChange: () => {}, onSelectSideChat: () => {}, onAddFiles: () => {},
    onChangeSelect: () => {}, onChangeDiffClose: () => {}, loadAttachment: async () => ({ ok: false, reason: 'runtime-unavailable', message: '无法下载', retryable: true }),
    ...overrides,
  } as PanelProps} />))
}
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(item => item.textContent?.includes(label))!

describe('task monitor interactions', () => {
  it('opens compact delivery previews and changes without duplicating a reviewed delivery', async () => {
    const onPreviewDelivery = vi.fn(), onChangeSelect = vi.fn()
    const shared = { seq: 5, index: 0, path: '/work/src/app.ts' }
    const report = { seq: 5, index: 1, path: '/work/report.pdf', description: '最终报告' }
    await renderPanel({ onPreviewDelivery, onChangeSelect,
      timeline: [{ taskId: 'task', itemId: 'answer', kind: 'assistant-message', text: '已完成', createdAt: '2026-10-08', presentedFiles: [shared, report] }],
      changes: [{ taskId: 'task', workspacePath: '/work', turn: 1, seq: 6, files: [{ path: 'src/app.ts', display: 'src/app.ts', added: 4, deleted: 2 }], total: 1, added: 4, deleted: 2 }],
    })
    expect(container.querySelectorAll('[title="/work/src/app.ts"]')).toHaveLength(0)
    expect(container.querySelectorAll('[title="src/app.ts"]')).toHaveLength(1)
    expect(container.textContent).toContain('+4')
    await act(async () => button('审阅 src/app.ts').click())
    expect(onChangeSelect).toHaveBeenCalledExactlyOnceWith({ seq: 6, index: 0 })
    await act(async () => button('预览 src/app.ts').click())
    await act(async () => button('预览 report.pdf').click())
    expect(onPreviewDelivery.mock.calls).toEqual([['task', shared], ['task', report]])
    const outputToggle = [...container.querySelectorAll<HTMLButtonElement>('[aria-controls]')].find(item => item.textContent === '产出')!
    expect(outputToggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(outputToggle.getAttribute('aria-controls')!)?.hidden).toBe(false)
  })

  it('shows every reviewed page and sends each link to the embedded browser', async () => {
    const navigation = vi.fn()
    window.addEventListener(browserNavigationEvent, navigation)
    try {
      await renderPanel({ timeline: [{ taskId: 'task', itemId: 'search', kind: 'tool-activity', title: 'web_search', text: JSON.stringify({ sources: Array.from({ length: 10 }, (_, index) => ({ url: `https://example.com/page-${index}`, title: `Page ${index}` })) }), status: 'completed', createdAt: '2026-10-08' }] })
      const links = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent?.startsWith('example.com/page-'))
      expect(links).toHaveLength(10)
      expect(links[9]?.querySelector('[title]')?.getAttribute('title')).toBe('Page 9\nhttps://example.com/page-9')
      await act(async () => links[9]!.click())
      expect((navigation.mock.calls[0]?.[0] as CustomEvent).detail.url).toBe('https://example.com/page-9')
    } finally { window.removeEventListener(browserNavigationEvent, navigation) }
  })

  it('offers attachment and URL input even before the first source, validating URL before changing the draft', async () => {
    const onPromptChange = vi.fn(), onAddFiles = vi.fn()
    await renderPanel({ prompt: '原始问题', onPromptChange, onAddFiles })
    await act(async () => button('添加来源').click())
    expect(menuItem('添加附件')).toBeTruthy()
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const openPicker = vi.spyOn(fileInput, 'click').mockImplementation(() => {})
    await act(async () => menuItem('添加附件').click())
    expect(openPicker).toHaveBeenCalledOnce()
    await act(async () => button('添加来源').click())
    await act(async () => menuItem('添加网页链接').click())
    const input = document.querySelector<HTMLInputElement>('input[name="prompt-dialog-value"]')!
    const set = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submit = async () => act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await set('javascript:alert(1)'); await submit()
    expect(onPromptChange).not.toHaveBeenCalled()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('HTTP 或 HTTPS')
    await set('https://example.com/reference'); await submit()
    expect(onPromptChange).toHaveBeenCalledExactlyOnceWith('原始问题\nhttps://example.com/reference')
    expect(onAddFiles).not.toHaveBeenCalled()
  })

  it('opens an empty Quick Notes board for the selected task', async () => {
    const opened = vi.fn()
    window.addEventListener(openTaskNotesEvent, opened)
    try {
      await renderPanel()
      await act(async () => container.querySelector<HTMLButtonElement>('[title="打开任务速记"]')!.click())
      expect((opened.mock.calls[0]?.[0] as CustomEvent).detail.taskId).toBe('task')
    } finally { window.removeEventListener(openTaskNotesEvent, opened) }
  })

  it('shows output download failures even when the sources section is hidden', async () => {
    const loadAttachment = vi.fn<PanelProps['loadAttachment']>(async () => ({ ok: false, reason: 'runtime-unavailable', message: '产出附件读取失败', retryable: true }))
    await renderPanel({ preferences: { ...defaultMonitorPreferences, sources: false }, loadAttachment,
      timeline: [{ taskId: 'task', itemId: 'generated', kind: 'assistant-message', text: '已生成', createdAt: '2026-10-08', attachments: [{ attachmentId: 'generated-image', kind: 'image', name: 'output.png' }] }],
    })
    await act(async () => button('下载 output.png').click())
    expect(loadAttachment).toHaveBeenCalledExactlyOnceWith('task', 'generated-image')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('产出附件读取失败')
    expect(button('下载 output.png').disabled).toBe(false)
    expect(container.textContent).not.toContain('来源')
  })
})
