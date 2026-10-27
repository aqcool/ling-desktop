import { terminalLinks } from './terminal-links.js'
import { readBehavior } from './behavior-preferences.js'
import { requestBrowserNavigation } from './browser-navigation.js'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Input } from '@heroui/react/input'
import { Button } from '@heroui/react/button'
import type { LingReadResult, LingTerminalView } from '../runtime/contract.js'
import { useAppearance, terminalMode, terminalTheme, metrics, type LingPalette, type ResolvedTheme } from '../theme.js'
import { tw } from './tailwind.js'

export function TerminalNameEditor({ title, onSave, onDone }: {
  readonly title: string
  readonly onSave: (title: string) => Promise<LingReadResult<void>>
  readonly onDone: (restoreFocus: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const submitted = useRef(false)
  const restoreFocus = useRef(false)
  const [saving, setSaving] = useState(false)
  useLayoutEffect(() => { input.current?.focus(); input.current?.select() }, [])
  const finish = () => { onDone(restoreFocus.current) }
  const save = async (value: string) => {
    if (submitted.current) return
    submitted.current = true
    const name = value.trim()
    if (!name || name === title) { finish(); return }
    setSaving(true)
    const result = await onSave(name)
    if (result.ok) finish()
    else { submitted.current = false; setSaving(false); input.current?.focus() }
  }
  return <Input ref={input} aria-label="终端名称" defaultValue={title} maxLength={120} readOnly={saving}
    className={tw("mx-1 h-control-xs w-36 min-w-0 rounded-sm border border-[var(--focus)] bg-transparent px-1.5 py-0 text-xs text-current shadow-none")}
    onBlur={(event: FocusEvent<HTMLInputElement>) => { void save(event.currentTarget.value) }}
    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()
      if (saving) return
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); submitted.current = true; restoreFocus.current = true; finish() }
      else if (event.key === 'Enter') { event.preventDefault(); restoreFocus.current = true; event.currentTarget.blur() }
    }} />
}

export function TerminalBody({ model }: { readonly model: LingTerminalView }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  useEffect(() => model.mount(), [model])
  const ended = state.phase === 'closed' || state.terminal?.state === 'exited'
  const reconnect = !ended && (state.phase === 'failed' || state.phase === 'disconnected' || (state.phase === 'connected' && !state.writable))
  const pending = ['idle', 'loading', 'creating', 'connecting'].includes(state.phase)
  return <div className={tw("flex min-h-0 min-w-0 flex-1 flex-col")}>
    {(state.error || ended || reconnect || pending) && <div role={state.error ? 'alert' : 'status'} className={tw("flex shrink-0 items-center gap-2 px-3 py-1 text-xs opacity-70")}>
      <span>{state.error ?? (ended ? `终端已退出${state.terminal?.exitCode === undefined ? '' : `（${state.terminal.exitCode}）`}` : pending ? '正在连接终端…' : state.phase === 'connected' ? '此终端正由另一窗口控制' : '终端连接已断开')}</span>
      {reconnect && <Button variant="ghost" size="sm" className={tw("h-control-xs text-xs text-current")} onPress={model.reconnect}>{state.phase === 'connected' ? '接管输入' : '重新连接'}</Button>}
    </div>}
    <TerminalScreen model={model} />
  </div>
}

function TerminalScreen({ model }: { readonly model: LingTerminalView }) {
  const element = useRef<HTMLDivElement>(null)
  const appearance = useAppearance()
  const mode = terminalMode(appearance, appearance.resolved)
  const palette = useRef<((mode: ResolvedTheme, palette: LingPalette) => void) | undefined>(undefined)
  const themeRef = useRef({ mode, palette: appearance.palette })
  themeRef.current = { mode, palette: appearance.palette }
  const [error, setError] = useState<string>()
  useLayoutEffect(() => {
    const node = element.current!
    let disposed = false
    let cleanup: (() => void) | undefined
    try {
      if (disposed) return
      const activateLink = (_event: MouseEvent, url: string) => {
        try {
          const target = new URL(url)
          if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return
          if (readBehavior().terminalLinksInBrowser) requestBrowserNavigation(target.href)
          else {
            const bridge = (window as unknown as { __LING_EXTERNAL_LINKS__?: { open(url: string): Promise<void> } }).__LING_EXTERNAL_LINKS__
            if (bridge) void bridge.open(target.href).catch(() => setError('无法打开系统浏览器。'))
            else window.open(target.href, '_blank', 'noopener,noreferrer')
          }
        } catch { setError('链接地址无效。') }
      }
      const terminal = new Terminal({ linkHandler: { activate: activateLink }, cursorBlink: true, fontSize: Number.parseFloat(metrics['font-size-compact']), fontFamily: metrics['font-code'], minimumContrastRatio: 4.5, scrollback: model.getSnapshot().scrollback ?? 3000, screenReaderMode: true, allowProposedApi: false })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      palette.current = (mode, palette) => { terminal.options.theme = terminalTheme(mode, palette) }
      palette.current(themeRef.current.mode, themeRef.current.palette)
      terminal.registerLinkProvider({ provideLinks: (row, callback) => callback(terminalLinks(terminal.buffer.active, row, activateLink)) })
      terminal.open(node)
      terminal.textarea?.setAttribute('aria-label', '终端输入')
      const input = terminal.onData(data => model.write(data))
      let revision = 0
      let lastSize = ''
      let wasWritable = false
      let writing = false
      const measure = () => {
        const state = model.getSnapshot()
        if (writing || !state.writable || !node.clientWidth || !node.clientHeight) return
        const dimensions = fit.proposeDimensions()
        if (!dimensions) return
        const cols = Math.min(dimensions.cols, state.maxCols ?? dimensions.cols)
        const rows = Math.min(dimensions.rows, state.maxRows ?? dimensions.rows)
        if (cols < 2 || rows < 1) return
        terminal.resize(cols, rows)
        const size = `${cols}:${rows}`
        if (lastSize !== size) { lastSize = size; model.resize(cols, rows) }
      }
      const update = () => {
        if (disposed) return
        const state = model.getSnapshot()
        terminal.options.disableStdin = !state.writable
        if (state.scrollback !== undefined) terminal.options.scrollback = state.scrollback
        if (state.writable && !wasWritable) { terminal.focus(); lastSize = '' }
        wasWritable = state.writable
        const render = state.render
        if (render && render.revision > revision) {
          revision = render.revision
          writing = true
          if (render.reset) {
            terminal.reset()
            if (render.cols && render.rows) terminal.resize(render.cols, render.rows)
            lastSize = ''
          }
          terminal.write(render.data, () => {
            if (disposed) return
            writing = false
            model.acknowledge(render.revision)
            measure()
          })
        } else measure()
      }
      const unsubscribe = model.subscribe(update)
      const observer = new ResizeObserver(measure)
      observer.observe(node)
      update()
      cleanup = () => { observer.disconnect(); unsubscribe(); input.dispose(); terminal.dispose(); palette.current = undefined }
    } catch { setError('终端组件加载失败，请重新打开面板。') }
    return () => { disposed = true; cleanup?.() }
  }, [model])
  useLayoutEffect(() => { palette.current?.(mode, appearance.palette) }, [mode, appearance.palette])
  return <>
    {error && <p role="alert" className={tw("px-3 text-xs text-[var(--danger)]")}>{error}</p>}
    <div className={tw("relative min-h-0 min-w-0 flex-1 overflow-hidden px-3 pb-2 pt-1")} onKeyDown={event => event.stopPropagation()}>
      <div className={tw("h-full w-full")} ref={element} />
    </div>
  </>
}
