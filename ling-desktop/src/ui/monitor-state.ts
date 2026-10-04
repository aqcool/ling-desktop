import type { MonitorPreferences } from './monitor-preferences.js'

export interface MonitorState {
  readonly context: string | null
  readonly open: boolean
  readonly pinned: boolean
  readonly visibility: Readonly<Record<string, boolean>>
}

export const initialMonitorState: MonitorState = { context: null, open: false, pinned: false, visibility: {} }

type MonitorAction =
  | { readonly type: 'enter'; readonly context: string; readonly defaultOpen: boolean }
  | { readonly type: 'toggle' }
  | { readonly type: 'pin' }
  | { readonly type: 'dismiss'; readonly presentation: MonitorPreferences['presentation'] }

export function monitorReducer(state: MonitorState, action: MonitorAction): MonitorState {
  if (action.type === 'enter') {
    if (state.context === action.context) return state
    const saved = Object.hasOwn(state.visibility, action.context) ? state.visibility[action.context] : undefined
    return { ...state, context: action.context, open: saved ?? action.defaultOpen, pinned: false }
  }
  if (action.type === 'pin' && !state.open) return state
  if (action.type === 'dismiss' && (action.presentation === 'fixed' || state.pinned || !state.open)) return state
  const open = action.type === 'toggle' ? !state.open : action.type === 'pin' ? !state.pinned : false
  return {
    ...state, open, pinned: action.type === 'pin' && open,
    visibility: state.context ? { ...state.visibility, [state.context]: open } : state.visibility,
  }
}
