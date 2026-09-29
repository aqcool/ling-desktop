import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseTaskNotes, readTaskNotes, removeTaskNote, saveTaskNote, taskNotesEvent } from '../src/ui/TaskNotes.js'
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) })
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())
it('isolates notes by session and supports updating and deleting without losing siblings', () => {
  const changed = vi.fn(); window.addEventListener(taskNotesEvent, changed)
  saveTaskNote('one', ' first '); saveTaskNote('two', 'other'); saveTaskNote('one', 'second')
  const first = readTaskNotes('one').find(note => note.text === 'first')!
  saveTaskNote('one', 'edited', first.id)
  expect(readTaskNotes('one').map(note => note.text)).toEqual(['second', 'edited'])
  removeTaskNote('one', first.id)
  expect(readTaskNotes('one').map(note => note.text)).toEqual(['second'])
  expect(readTaskNotes('two').map(note => note.text)).toEqual(['other'])
  expect(changed).toHaveBeenCalledTimes(5)
  expect(() => saveTaskNote('one', 'stale edit', first.id)).toThrow('已被删除')
})
it('preserves corrupt stored data and propagates storage errors', () => {
  const key = 'ling.task-notes.v1:broken'
  data.set(key, '[{"text":"valuable content"}]')
  const original = data.get(key)
  expect(() => saveTaskNote('broken', 'replacement')).toThrow()
  expect(data.get(key)).toBe(original)
  expect(() => parseTaskNotes('{')).toThrow()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Storage full') } })
  expect(() => saveTaskNote('one', 'keep draft')).toThrow('Storage full')
})
it('rejects blank and oversized notes before writing', () => {
  expect(() => saveTaskNote('one', '   ')).toThrow()
  expect(() => saveTaskNote('one', 'x'.repeat(20001))).toThrow()
  expect(data.size).toBe(0)
})
