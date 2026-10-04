import type { NoteOrigin } from './quick-notes-store.js'
export interface NoteWindowAction { action: 'attach' | 'source'; id: string }
export interface NativeQuickNotes {
  open: (origin?: NoteOrigin) => Promise<void>
  context: () => Promise<NoteOrigin | undefined>
  onContext: (callback: (origin?: NoteOrigin) => void) => () => void
  send: (action: NoteWindowAction) => Promise<void>
  onAction: (callback: (action: NoteWindowAction) => void) => () => void
}
export const nativeQuickNotes = () => (window as Window & { __LING_QUICK_NOTES__?: NativeQuickNotes }).__LING_QUICK_NOTES__
