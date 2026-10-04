import { expect, it } from 'vitest'
import { parseNoteWindowAction, parseNoteWindowContext, quickNotesUrl } from '../src/quick-notes-window.ts'
it('uses a fixed owned surface and accepts only bounded task metadata', () => {
  expect(quickNotesUrl).toBe('dsh-app://app/?surface=quick-notes')
  expect(parseNoteWindowContext(undefined)).toBeUndefined()
  expect(parseNoteWindowContext({ taskId: 'task', title: 'Task', workspace: 'LING', url: 'https://evil' })).toEqual({ taskId: 'task', title: 'Task', workspace: 'LING' })
  for (const value of [{ taskId: '' }, { taskId: 'x'.repeat(257) }, { taskId: 'task', title: 1 }, 'task']) expect(() => parseNoteWindowContext(value)).toThrow()
})
it('does not accept arbitrary window actions or payloads', () => {
  expect(parseNoteWindowAction({ action: 'attach', id: 'note', text: 'ignored' })).toEqual({ action: 'attach', id: 'note' })
  expect(parseNoteWindowAction({ action: 'source', id: 'note' })).toEqual({ action: 'source', id: 'note' })
  for (const value of [null, { action: 'execute', id: 'note' }, { action: 'source', id: '' }, { action: 'attach', id: 'x'.repeat(257) }]) expect(() => parseNoteWindowAction(value)).toThrow()
})
