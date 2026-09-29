import type { IBuffer } from '@xterm/xterm'
import { expect, it, vi } from 'vitest'
import { terminalLinks } from '../src/ui/terminal-links.js'
function buffer(rows: { text: string; wrapped?: boolean }[]): IBuffer {
  return { length: rows.length, getLine: (index: number) => {
    const row = rows[index]; if (!row) return undefined
    const cells = [...row.text].flatMap(char => char === '中' ? [{ getChars: () => char, getWidth: () => 2 }, { getChars: () => '', getWidth: () => 0 }] : [{ getChars: () => char, getWidth: () => 1 }])
    return { isWrapped: row.wrapped ?? false, length: cells.length, getCell: (column: number) => cells[column] }
  } } as IBuffer
}
it('maps wrapped URLs and wide characters to terminal cell coordinates', () => {
  const activate = vi.fn()
  const rows = buffer([{ text: '中 https://exam' }, { text: 'ple.com/path end', wrapped: true }])
  const links = terminalLinks(rows, 2, activate)
  expect(links).toMatchObject([{ text: 'https://example.com/path', range: { start: { x: 4, y: 1 }, end: { x: 12, y: 2 } } }])
  links[0]!.activate({} as MouseEvent, links[0]!.text)
  expect(activate).toHaveBeenCalledOnce()
})
it('does not join unrelated rows or create credential-bearing and invalid links', () => {
  expect(terminalLinks(buffer([{ text: 'https://example.com' }, { text: '/other' }]), 2, vi.fn())).toEqual([])
  expect(terminalLinks(buffer([{ text: 'https://u:p@example.com http:// javascript:bad' }]), 1, vi.fn())).toEqual([])
  expect(terminalLinks(buffer([{ text: '(http://localhost:3000/path).' }]), 1, vi.fn())[0]?.text).toBe('http://localhost:3000/path')
})
