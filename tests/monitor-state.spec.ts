import { describe, expect, it } from 'vitest'
import { initialMonitorState, monitorReducer } from '../src/ui/monitor-state.js'
import { effectiveMonitorPresentation } from '../src/ui/monitor-preferences.js'

describe('task monitor transitions', () => {
  it('keeps a manually hidden monitor closed through workbench transitions and returning to the task', () => {
    let state = monitorReducer(initialMonitorState, { type: 'enter', context: 'a', defaultOpen: true })
    state = monitorReducer(state, { type: 'toggle' })
    for (const workbenchOpen of [true, false, true]) {
      expect(effectiveMonitorPresentation('fixed', workbenchOpen, 1200)).toBe(workbenchOpen ? 'floating' : 'fixed')
      state = monitorReducer(state, { type: 'enter', context: 'a', defaultOpen: true })
      expect(state.open).toBe(false)
    }
    state = monitorReducer(state, { type: 'enter', context: 'b', defaultOpen: true })
    expect(state.open).toBe(true)
    state = monitorReducer(state, { type: 'enter', context: 'a', defaultOpen: true })
    expect(state.open).toBe(false)
  })

  it('dismisses a temporary floating monitor while keeping fixed and pinned monitors open', () => {
    let state = monitorReducer(initialMonitorState, { type: 'enter', context: 'a', defaultOpen: true })
    expect(monitorReducer(state, { type: 'dismiss', presentation: 'fixed' })).toBe(state)
    state = monitorReducer(state, { type: 'dismiss', presentation: 'floating' })
    expect(state).toMatchObject({ open: false, pinned: false })
    expect(monitorReducer(state, { type: 'pin' })).toBe(state)
    state = monitorReducer(state, { type: 'toggle' })
    state = monitorReducer(state, { type: 'pin' })
    expect(state).toMatchObject({ open: true, pinned: true })
    expect(monitorReducer(state, { type: 'dismiss', presentation: 'floating' })).toBe(state)
    state = monitorReducer(state, { type: 'pin' })
    expect(state).toMatchObject({ open: false, pinned: false })
  })

  it('does not carry a pinned floating monitor into a different task', () => {
    let state = monitorReducer(initialMonitorState, { type: 'enter', context: 'a', defaultOpen: true })
    state = monitorReducer(state, { type: 'pin' })
    state = monitorReducer(state, { type: 'enter', context: 'b', defaultOpen: false })
    expect(state).toMatchObject({ context: 'b', open: false, pinned: false })
    state = monitorReducer(state, { type: 'enter', context: 'a', defaultOpen: false })
    expect(state).toMatchObject({ open: true, pinned: false })
  })

  it('uses floating semantics when chat space is too narrow, without changing the preferred presentation', () => {
    expect(effectiveMonitorPresentation('fixed', false, 799)).toBe('floating')
    expect(effectiveMonitorPresentation('fixed', false, 800)).toBe('fixed')
    expect(effectiveMonitorPresentation('floating', false, 1200)).toBe('floating')
    expect(effectiveMonitorPresentation('fixed', true, 1200)).toBe('floating')
  })
})
