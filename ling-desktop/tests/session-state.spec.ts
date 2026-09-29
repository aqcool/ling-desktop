import { describe, expect, it } from 'vitest'
import {
  parseStoredBrowserNavigation,
  parseStoredBrowserOpen,
  parseStoredDocumentPaths,
  parseStoredDrafts,
  parseStoredInspector,
  pickRestorableTaskId,
  serializeBrowserNavigation,
  serializeDocumentPaths,
  serializeDrafts,
} from '../src/session-state.js'

describe('composer draft persistence', () => {
  it('ignores unreadable payloads', () => {
    expect(parseStoredDrafts(null)).toEqual({})
    expect(parseStoredDrafts('not json')).toEqual({})
    expect(parseStoredDrafts('[]')).toEqual({})
    expect(parseStoredDrafts('"task-1"')).toEqual({})
  })

  it('keeps only non-empty string drafts', () => {
    expect(parseStoredDrafts(JSON.stringify({
      'task-1': '继续改测试',
      'task-2': '',
      'task-3': 7,
      'task-4': { text: 'x' },
    }))).toEqual({ 'task-1': '继续改测试' })
  })

  it('round-trips drafts and drops empty ones', () => {
    const stored = serializeDrafts({
      'task-1': { text: '  保持缩进\n第二行' },
      'task-2': { text: '' },
    })
    expect(parseStoredDrafts(stored)).toEqual({ 'task-1': '  保持缩进\n第二行' })
  })
})

describe('selected task restoration', () => {
  it('restores only a task the runtime still lists', () => {
    expect(pickRestorableTaskId(null, ['task-1'])).toBeUndefined()
    expect(pickRestorableTaskId('task-9', ['task-1', 'task-2'])).toBeUndefined()
    expect(pickRestorableTaskId('task-2', ['task-1', 'task-2'])).toBe('task-2')
  })
})

describe('right inspector preference', () => {
  it('is open unless the stored value says otherwise', () => {
    expect(parseStoredInspector(null)).toBe(true)
    expect(parseStoredInspector('1')).toBe(true)
    expect(parseStoredInspector('0')).toBe(false)
  })
})

describe('browser panel preference', () => {
  it('is closed unless the stored value says otherwise', () => {
    expect(parseStoredBrowserOpen(null)).toBe(false)
    expect(parseStoredBrowserOpen('0')).toBe(false)
    expect(parseStoredBrowserOpen('1')).toBe(true)
  })

  it('round-trips the address history and clamps a stale index', () => {
    const stored = serializeBrowserNavigation({ entries: ['https://a.example/', 'https://b.example/'], index: 0 })
    expect(parseStoredBrowserNavigation(stored)).toEqual({
      entries: ['https://a.example/', 'https://b.example/'],
      index: 0,
    })
    expect(parseStoredBrowserNavigation('{"entries":["https://a.example/"],"index":5}')).toEqual({
      entries: ['https://a.example/'],
      index: 0,
    })
  })

  it('ignores unreadable payloads and non-string entries', () => {
    expect(parseStoredBrowserNavigation(null)).toEqual({ entries: [], index: -1 })
    expect(parseStoredBrowserNavigation('not json')).toEqual({ entries: [], index: -1 })
    expect(parseStoredBrowserNavigation('[]')).toEqual({ entries: [], index: -1 })
    expect(parseStoredBrowserNavigation('{"entries":["https://a.example/",3,""],"index":0}')).toEqual({
      entries: ['https://a.example/'],
      index: 0,
    })
  })
})

describe('opened workspace document restoration', () => {
  it('round-trips per-task document paths', () => {
    const stored = serializeDocumentPaths({ 'task-1': 'docs/plan.md', 'task-2': '' })
    expect(parseStoredDocumentPaths(stored)).toEqual({ 'task-1': 'docs/plan.md' })
    expect(parseStoredDocumentPaths(null)).toEqual({})
    expect(parseStoredDocumentPaths('not json')).toEqual({})
  })
})
