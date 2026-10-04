import type { LingReadResult } from './contract.js'

export const computerControlNamespace = 'ling-computer-control'
export const snapshotShortcuts = ['', 'CommandOrControl+Shift+S', 'CommandOrControl+Shift+X'] as const
export interface LingComputerControlPreferences { browserEnabled: boolean; recordingEnabled: boolean; snapshotShortcut: string }
export const defaultComputerControlPreferences: LingComputerControlPreferences = { browserEnabled: false, recordingEnabled: false, snapshotShortcut: '' }
export interface LingComputerCapabilities { browser: boolean; recording: boolean; snapshot: boolean }
export interface LingComputerSnapshot {
  title: string; text: string
  images: { name: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }[]
}
export interface LingComputerControlService {
  capabilities(): Promise<LingReadResult<LingComputerCapabilities>>
  snapshot(): Promise<LingReadResult<LingComputerSnapshot>>
}
export interface LingSnapshotShortcutBridge {
  setShortcut(value: string): Promise<LingReadResult<void>>
  subscribe(callback: () => void): () => void
  reveal(): Promise<void>
}
