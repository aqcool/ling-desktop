import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseTaskNotes, readTaskNotes, removeTaskNote, saveTaskNote, taskNotesEvent, taskNoteText } from '../src/ui/TaskNotes.js'
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  vi.stubGlobal('localStorage', { get length() { return data.size }, key: (index: number) => [...data.keys()][index] ?? null, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
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
it('preserves quoted reply identity when editing an annotation and reattaches original plus comment', () => {
  saveTaskNote('task', 'ordinary note')
  const source = { messageId: 'reply-7', quote: 'original line\nsecond line' }
  const id = saveTaskNote('task', 'initial comment', undefined, source)
  saveTaskNote('task', 'edited comment', id)
  const note = readTaskNotes('task').find(item => item.id === id)!
  expect(note.source).toEqual(source)
  expect(taskNoteText(note)).toBe('> original line\n> second line\n\n批注：edited comment')
  expect(readTaskNotes('task').find(item => !item.source)?.text).toBe('ordinary note')
  removeTaskNote('task', id)
  expect(readTaskNotes('task').map(item => item.text)).toEqual(['ordinary note'])
  expect(readTaskNotes('other')).toEqual([])
})
it('refuses invalid or oversized annotation sources and preserves corrupt stored annotations', () => {
  expect(() => saveTaskNote('task', 'comment', undefined, { messageId: '', quote: 'original' })).toThrow()
  expect(() => saveTaskNote('task', 'comment', undefined, { messageId: 'reply', quote: 'x'.repeat(20001) })).toThrow()
  expect(data.size).toBe(0)
  const key = 'ling.task-notes.v1:broken'
  const original = JSON.stringify([{ id: 'annotation', text: 'comment', updatedAt: 'today', source: { messageId: 'reply', quote: 1 } }])
  data.set(key, original)
  expect(() => saveTaskNote('broken', 'replacement')).toThrow('已保留原始内容')
  expect(data.get(key)).toBe(original)
})
