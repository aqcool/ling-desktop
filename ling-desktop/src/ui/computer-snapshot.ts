import { computerControlNamespace, defaultComputerControlPreferences, type LingComputerControlPreferences, type LingComputerControlService, type LingComputerSnapshot, type LingSnapshotShortcutBridge } from '../runtime/computer-control.js'
import type { LingPluginOverview } from '../runtime/contract.js'

export function computerPreferences(overview?: LingPluginOverview): LingComputerControlPreferences {
  const value = overview?.namespaces.find(ns => ns.ns === computerControlNamespace)?.value
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return { ...defaultComputerControlPreferences, browserEnabled: stored.browserEnabled === true, recordingEnabled: stored.recordingEnabled === true, snapshotShortcut: typeof stored.snapshotShortcut === 'string' ? stored.snapshotShortcut : '' }
}
export function nativeComputerEntry(overview?: LingPluginOverview) {
  return overview?.bundles.find(bundle => bundle.name === 'ling-desktop-host')?.rows.find(row => row.moduleName === 'ling-desktop-host/computer-use')
}
export function enabledSnapshotShortcut(overview: LingPluginOverview): string {
  const entry = nativeComputerEntry(overview)
  return entry?.enabled && entry.phase === 'active' ? computerPreferences(overview).snapshotShortcut : ''
}
export function nativeSnapshotBridge(): LingSnapshotShortcutBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { __LING_COMPUTER_SNAPSHOT__?: LingSnapshotShortcutBridge }).__LING_COMPUTER_SNAPSHOT__
}
export function snapshotFiles(snapshot: LingComputerSnapshot): File[] {
  return snapshot.images.map(image => new File([Uint8Array.from(atob(image.data), char => char.charCodeAt(0))], image.name, { type: image.mediaType }))
}
export async function prepareComputerSnapshot(computer: LingComputerControlService, draftId: string, currentDraft: () => string | undefined,
  deliver: (files: File[], text: string, title: string) => void): Promise<void> {
  const snapshot = await computer.snapshot()
  if (!snapshot.ok) throw new Error(snapshot.message)
  if (currentDraft() !== draftId) throw new Error('会话已切换，快照未加入输入框，请重新截取。')
  deliver(snapshotFiles(snapshot.value), snapshot.value.text, snapshot.value.title)
}
