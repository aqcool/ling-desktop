import { useCallback, useEffect, useRef, useState } from 'react'
import type { LingComputerControlService, LingPluginManager } from '../runtime/contract.js'
import { enabledSnapshotShortcut, nativeSnapshotBridge, prepareComputerSnapshot } from './computer-snapshot.js'

/** Capture before bringing LING forward, then reuse the existing unsent draft. */
export function useComputerSnapshot(options: {
  manager?: LingPluginManager; computer?: LingComputerControlService; draftId: string
  addFiles(files: File[]): void; addQuote(text: string, preview: string): void; openWorkspace(): void
}) {
  const latest = useRef(options); latest.current = options
  const capturing = useRef(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(false)
  const generation = useRef(0)
  const capture = useCallback(async () => {
    const initial = latest.current
    if (!mounted.current || capturing.current || !initial.computer) return
    const epoch = generation.current
    capturing.current = true; setError(undefined)
    try {
      await prepareComputerSnapshot(initial.computer, initial.draftId,
        () => mounted.current && generation.current === epoch ? latest.current.draftId : undefined,
        (files, text, title) => { latest.current.addFiles(files); if (text) latest.current.addQuote(text, title) })
    } catch (error) {
      if (mounted.current && generation.current === epoch) setError(error instanceof Error ? error.message : '应用快照失败，请重试。')
    } finally {
      capturing.current = false
      if (mounted.current && generation.current === epoch) {
        latest.current.openWorkspace()
        try { await nativeSnapshotBridge()?.reveal() } catch { setError('无法显示应用窗口，请手动打开灵创。') }
      }
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    generation.current++
    const bridge = nativeSnapshotBridge()
    const manager = options.manager
    if (!bridge || !manager || !options.computer) return () => { mounted.current = false; generation.current++ }
    let disposed = false
    let queue = Promise.resolve()
    const refresh = () => {
      queue = queue.then(async () => {
        if (disposed) return
        try {
          const read = await manager.read()
          if (disposed) return
          const registered = await bridge.setShortcut(read.ok ? enabledSnapshotShortcut(read.value) : '')
          if (!disposed && !registered.ok) setError(registered.message)
        } catch { if (!disposed) { await bridge.setShortcut(''); setError('无法更新应用快照快捷键。') } }
      }).catch(() => {})
    }
    const offRequest = bridge.subscribe(() => { void capture() })
    const offSettings = manager.subscribe(event => { if (event.type === 'changed') refresh() })
    refresh()
    return () => { disposed = true; mounted.current = false; generation.current++; offRequest(); offSettings(); void bridge.setShortcut('').catch(() => {}) }
  }, [options.manager, options.computer, capture])
  return { error, retry: () => { void capture() } }
}
