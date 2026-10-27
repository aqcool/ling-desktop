// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskServerPicker } from '../src/ui/TaskServerPicker.js'

type Props = ComponentProps<typeof TaskServerPicker>
let root: Root
const servers = [
  { id: 'a', name: '开发服务器', alias: 'dev.example', environment: 'development' as const },
  { id: 'b', name: '生产服务器', alias: 'prod.example', environment: 'production' as const },
]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })
async function mount(props: Partial<Props> = {}) {
  const onApply = vi.fn(async () => true)
  await act(async () => { root.render(<TaskServerPicker servers={servers} serverIds={['a']} onApply={onApply} onManageServers={vi.fn()} {...props} />) })
  return onApply
}
async function button(text: string) {
  const target = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === text || item.textContent?.startsWith(text))
  expect(target, text).toBeDefined()
  await act(async () => { target!.click() })
}
function checkbox(name: string) {
  const label = document.querySelector(`[aria-label="${name}"]`)
  const input = label?.matches('input') ? label : label?.querySelector('input')
  expect(input, name).toBeTruthy()
  return input as HTMLInputElement
}
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索服务器"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('stages searchable checkbox selections and saves the complete set only on Apply', async () => {
  const save = await mount()
  await button('关联服务器')
  expect(checkbox('开发服务器').checked).toBe(true)
  await search('prod.example')
  expect(document.querySelector('[aria-label="开发服务器"]')).toBeNull()
  await act(async () => { checkbox('生产服务器').click() })
  expect(save).not.toHaveBeenCalled()
  await button('应用')
  expect(save).toHaveBeenCalledExactlyOnceWith(['a', 'b'], undefined)
})

it('cancels staged edits and keeps the development server checked and immutable', async () => {
  const save = await mount({ developmentServerId: 'a' })
  await button('关联服务器')
  expect(checkbox('开发服务器').disabled).toBe(true)
  await act(async () => { checkbox('生产服务器').click() })
  await button('取消')
  expect(save).not.toHaveBeenCalled()
  await button('关联服务器')
  expect(checkbox('生产服务器').checked).toBe(false)
  expect(checkbox('开发服务器').checked).toBe(true)
})

it('preserves selections and keeps the dialog open after a failed atomic save', async () => {
  const onApply = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await mount({ onApply })
  await button('关联服务器')
  await act(async () => { checkbox('生产服务器').click() })
  await button('应用')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('未保存')
  expect(checkbox('生产服务器').checked).toBe(true)
  await button('应用')
  expect(onApply).toHaveBeenNthCalledWith(2, ['a', 'b'], undefined)
})

it('keeps the opened revision when the association list changes before Apply', async () => {
  const onApply = vi.fn(async () => false)
  const props = { servers, serverIds: ['a'], revision: 4, onApply, onManageServers: vi.fn() }
  await mount(props)
  await button('关联服务器')
  await act(async () => { checkbox('生产服务器').click() })
  await act(async () => { root.render(<TaskServerPicker {...props} serverIds={['a', 'new-server']} revision={5} />) })
  await button('应用')
  expect(onApply).toHaveBeenCalledExactlyOnceWith(['a', 'b'], 4)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('未保存')
})
