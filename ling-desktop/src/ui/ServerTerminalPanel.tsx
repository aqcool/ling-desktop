import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button } from '@heroui/react/button'
import type { LingServerService } from '../runtime/servers.js'
import { Icon } from './Icon.js'
import { useAppearance, updateAppearance, terminalMode, terminalTheme, metrics, type LingPalette, type ResolvedTheme } from '../theme.js'
import { tw } from './tailwind.js'
import { initializeServerTerminals } from './server-terminal-initialization.js'

/** SSH PTYs may belong to an existing task or a server selected before creating one. */
export function ServerTerminalPanel({ service, taskId, serverId, placement = 'bottom', onClose }: {
  readonly service: LingServerService
  readonly taskId?: string
  readonly serverId?: string
  readonly placement?: 'side' | 'bottom'
  readonly onClose?: () => void
}) {
  const [draftOwner, setDraftOwner] = useState<{ serverId: string; placement: string; ownerId: string }>()
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (taskId || !serverId) return
    let active = true
    setError(undefined)
    void service.terminalScope(serverId, placement).then(result => {
      if (!active) return
      if (result.ok) setDraftOwner({ serverId, placement, ownerId: result.value.ownerId })
      else setError(result.message)
    })
    return () => { active = false }
  }, [service, taskId, serverId, placement, retry])
  const ownerId = taskId ?? (draftOwner?.serverId === serverId && draftOwner?.placement === placement ? draftOwner.ownerId : undefined)
  return ownerId ? <ServerTerminalTabs key={ownerId} service={service} taskId={ownerId} onClose={onClose} />
    : <section aria-label="远端终端" className={tw('flex min-h-0 flex-1 items-center justify-center text-xs text-[var(--text-tertiary)]')}>
      <p role={error ? 'alert' : 'status'}>{error ?? '正在连接终端…'}</p>
      {error && <Button variant="ghost" size="sm" onPress={() => setRetry(value => value + 1)}>重试</Button>}
      {onClose && <Button isIconOnly aria-label="关闭终端面板" variant="ghost" onPress={onClose}><Icon name="close" size={15} /></Button>}
    </section>
}

/** Closing this panel leaves the shell running; closing a tab ends its PTY. */
function ServerTerminalTabs({ service, taskId, onClose }: {
  readonly service: LingServerService
  readonly taskId: string
  readonly onClose?: () => void
}) {
  const appearance = useAppearance()
  const mode = terminalMode(appearance, appearance.resolved)
  const dark = mode === 'dark'
  const [ids, setIds] = useState<readonly string[]>([])
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void initializeServerTerminals(service, taskId).then(result => {
      if (!active) return
      if (!result.ok) { setError(result.message); return }
      setIds(result.value)
      setSelected(result.value.at(-1))
    })
    return () => { active = false }
  }, [service, taskId])
  const create = async () => {
    setBusy(true)
    setError(undefined)
    const result = await service.terminalOpen(taskId, 80, 24)
    if (result.ok) { setIds(current => [...current, result.value.terminalId]); setSelected(result.value.terminalId) }
    else setError(result.message)
    setBusy(false)
  }
  const close = async (id: string) => {
    const result = await service.terminalClose(taskId, id)
    if (!result.ok) { setError(result.message); return }
    setIds(current => current.filter(item => item !== id))
    if (selected === id) setSelected(ids.filter(item => item !== id).at(-1))
  }
  return <section aria-label="远端终端" data-theme={mode} data-palette={appearance.palette} className={tw('flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--terminal-background)] text-[var(--terminal-foreground)]')}>
    <div className={tw("flex h-control-lg shrink-0 items-center gap-1 border-b border-[var(--panel-border)] px-2")}>
      <div role="tablist" aria-label="远端终端列表" className={tw('flex min-w-0 flex-1 gap-1 overflow-x-auto')}>
        {ids.map((id, index) => <div key={id} className={tw('flex shrink-0 items-center rounded-md', selected === id && 'bg-[var(--surface-selected)]')}>
          <button type="button" role="tab" aria-selected={selected === id} className={tw("flex h-control-sm items-center gap-1 px-2 text-xs")} onClick={() => setSelected(id)}>
            <Icon name="terminal" size={13} />服务器 {index + 1}
          </button>
          <Button isIconOnly aria-label={`关闭远端终端 ${index + 1}`} variant="ghost" className={tw('size-5 min-w-5 p-0 text-current')} onPress={() => { void close(id) }}><Icon name="close" size={12} /></Button>
        </div>)}
      </div>
      <Button isIconOnly aria-label="新建远端终端" variant="ghost" className={tw("size-control-sm min-w-7 p-0 text-current")} isDisabled={busy} onPress={() => { void create() }}><Icon name="plus" size={15} /></Button>
      <Button isIconOnly aria-label={dark ? '切换为浅色终端' : '切换为深色终端'} variant="ghost" className={tw("size-control-sm min-w-7 p-0 text-current")} onPress={() => updateAppearance({ terminal: 'manual', terminalDark: !dark })}><Icon name={dark ? 'sun' : 'moon'} size={16} /></Button>
      {onClose && <Button isIconOnly aria-label="关闭终端面板" variant="ghost" className={tw("size-control-sm min-w-7 p-0 text-current")} onPress={onClose}><Icon name="close" size={15} /></Button>}
    </div>
    {error && <p role="alert" className={tw('m-0 px-3 py-1 text-xs text-[var(--danger)]')}>{error}</p>}
    {selected ? <ServerTerminalScreen key={selected} service={service} taskId={taskId} terminalId={selected} />
      : <div className={tw('flex flex-1 items-center justify-center text-xs opacity-60')}>正在连接终端…</div>}
  </section>
}

function ServerTerminalScreen({ service, taskId, terminalId }: {
  readonly service: LingServerService
  readonly taskId: string
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
    const terminal = new Terminal({ cursorBlink: true, fontSize: Number.parseFloat(metrics['font-size-compact']), fontFamily: metrics['font-code'], minimumContrastRatio: 4.5, scrollback: 5000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    applyTheme.current = (mode, palette) => { terminal.options.theme = terminalTheme(mode, palette) }
    applyTheme.current(themeRef.current.mode, themeRef.current.palette)
    terminal.open(node)
    terminal.textarea?.setAttribute('aria-label', '远端终端输入')
    const resize = () => {
      try { fit.fit(); void service.terminalResize(taskId, terminalId, terminal.cols, terminal.rows) }
      catch { /* Size will be retried on the next layout. */ }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    const input = terminal.onData(data => { void service.terminalWrite(taskId, terminalId, data).then(result => {
      if (!result.ok) setMessage(result.message)
    }) })
    let decoder = new TextDecoder()
    let offset = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped) return
      const result = await service.terminalPoll(taskId, terminalId, offset)
      if (stopped) return
      if (!result.ok) { setMessage(result.message); timer = setTimeout(poll, 1000); return }
      if (result.value.truncated) { terminal.reset(); decoder = new TextDecoder() }
      offset = result.value.offset
      if (result.value.data) {
        const bytes = Uint8Array.from(atob(result.value.data), character => character.charCodeAt(0))
        const text = decoder.decode(bytes, { stream: !result.value.closed })
        await new Promise<void>(resolve => terminal.write(text, resolve))
      }
      if (result.value.error) setMessage(result.value.error)
      else if (result.value.closed) setMessage(`终端已退出${result.value.exitCode === undefined ? '' : `（${result.value.exitCode}）`}`)
      if (!result.value.closed || result.value.data) timer = setTimeout(poll, result.value.data ? 0 : 150)
    }
    resize()
    terminal.focus()
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer); observer.disconnect(); input.dispose(); terminal.dispose(); applyTheme.current = undefined }
  }, [service, taskId, terminalId])
  useLayoutEffect(() => { applyTheme.current?.(mode, appearance.palette) }, [mode, appearance.palette])
  return <div className={tw('flex min-h-0 flex-1 flex-col')}>
    {message && <p role="status" className={tw('m-0 px-3 py-1 text-xs text-[var(--warning)]')}>{message}</p>}
    <div ref={element} className={tw('min-h-0 flex-1 overflow-hidden px-3 py-2')} />
  </div>
}
