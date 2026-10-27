import { useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { LingServerService } from '../runtime/servers.js'
import { useAppearance, terminalMode, terminalTheme, metrics, type LingPalette, type ResolvedTheme } from '../theme.js'
import { tw } from './tailwind.js'

/** A view detaches when hidden; only an explicit tab close terminates its captured owner PTY. */
export function ServerTerminalScreen({ service, ownerId, terminalId }: {
  readonly service: LingServerService
  readonly ownerId: string
  readonly terminalId: string
}) {
  const appearance = useAppearance()
  const mode = terminalMode(appearance, appearance.resolved)
  const themeRef = useRef({ mode, palette: appearance.palette })
  themeRef.current = { mode, palette: appearance.palette }
  const applyTheme = useRef<((mode: ResolvedTheme, palette: LingPalette) => void) | undefined>(undefined)
  const element = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState<string>()
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const controller = new AbortController()
    const terminal = new Terminal({ cursorBlink: true, fontSize: Number.parseFloat(metrics['font-size-compact']), fontFamily: metrics['font-code'], minimumContrastRatio: 4.5, scrollback: 5000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    applyTheme.current = (mode, palette) => { terminal.options.theme = terminalTheme(mode, palette) }
    applyTheme.current(themeRef.current.mode, themeRef.current.palette)
    terminal.open(node)
    terminal.textarea?.setAttribute('aria-label', '远端终端输入')
    const resize = () => {
      if (!node.clientWidth || !node.clientHeight || controller.signal.aborted) return
      try { fit.fit(); void service.terminalResize(ownerId, terminalId, terminal.cols, terminal.rows, controller.signal).catch(() => {}) }
      catch { /* Size will be retried on the next layout. */ }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    const input = terminal.onData(data => { void service.terminalWrite(ownerId, terminalId, data, controller.signal).then(result => {
      if (!controller.signal.aborted && !result.ok) setMessage(result.message)
    }).catch(() => { if (!controller.signal.aborted) setMessage('无法写入终端，请重试。') }) })
    let decoder = new TextDecoder()
    let offset = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped) return
      let result
      try { result = await service.terminalPoll(ownerId, terminalId, offset, controller.signal) }
      catch {
        if (!stopped) { setMessage('终端连接暂时中断，正在重试…'); timer = setTimeout(poll, 1000) }
        return
      }
      if (stopped) return
      if (!result.ok) { setMessage(result.message); timer = setTimeout(poll, 1000); return }
      if (result.value.truncated) { terminal.reset(); decoder = new TextDecoder() }
      offset = result.value.offset
      if (result.value.data) {
        const bytes = Uint8Array.from(atob(result.value.data), character => character.charCodeAt(0))
        const text = decoder.decode(bytes, { stream: !result.value.closed })
        await new Promise<void>(resolve => terminal.write(text, resolve))
      }
      if (stopped) return
      if (result.value.error) setMessage(result.value.error)
      else if (result.value.closed) setMessage(`终端已退出${result.value.exitCode === undefined ? '' : `（${result.value.exitCode}）`}`)
      if (!result.value.closed || result.value.data) timer = setTimeout(poll, result.value.data ? 0 : 150)
    }
    resize()
    terminal.focus()
    void poll()
    return () => { stopped = true; controller.abort(); if (timer) clearTimeout(timer); observer.disconnect(); input.dispose(); terminal.dispose(); applyTheme.current = undefined }
  }, [service, ownerId, terminalId])
  useLayoutEffect(() => { applyTheme.current?.(mode, appearance.palette) }, [mode, appearance.palette])
  return <div className={tw('flex min-h-0 flex-1 flex-col')}>
    {message && <p role="status" className={tw('m-0 px-3 py-1 text-xs text-[var(--warning)]')}>{message}</p>}
    <div ref={element} className={tw('min-h-0 flex-1 overflow-hidden px-3 py-2')} />
  </div>
}
