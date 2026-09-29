import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button } from '@heroui/react/button'
import type { LingServerService } from '../runtime/servers.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

/** A task-bound SSH PTY. Closing this panel leaves the shell running. */
export function ServerTerminalPanel({ service, taskId, onClose }: {
  readonly service: LingServerService
  readonly taskId: string
  readonly onClose?: () => void
}) {
  const [ids, setIds] = useState<readonly string[]>([])
  const [selected, setSelected] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void service.terminalList(taskId).then(async result => {
      if (!active) return
      if (!result.ok) { setError(result.message); return }
      if (result.value.length) { setIds(result.value); setSelected(result.value.at(-1)); return }
      const opened = await service.terminalOpen(taskId, 80, 24)
      if (!active) return
      if (!opened.ok) { setError(opened.message); return }
      setIds([opened.value.terminalId])
      setSelected(opened.value.terminalId)
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
  return <section aria-label="远端终端" className={tw('flex min-h-0 min-w-0 flex-1 flex-col bg-[#1b1b1e] text-[#e8e8e9]')}>
    <div className={tw('flex h-9 shrink-0 items-center gap-1 border-b border-white/10 px-2')}>
      <div role="tablist" aria-label="远端终端列表" className={tw('flex min-w-0 flex-1 gap-1 overflow-x-auto')}>
        {ids.map((id, index) => <div key={id} className={tw('flex shrink-0 items-center rounded-md', selected === id && 'bg-white/10')}>
          <button type="button" role="tab" aria-selected={selected === id} className={tw('flex h-7 items-center gap-1 px-2 text-xs')} onClick={() => setSelected(id)}>
            <Icon name="terminal" size={13} />服务器 {index + 1}
          </button>
          <Button isIconOnly aria-label={`关闭远端终端 ${index + 1}`} variant="ghost" className={tw('size-5 min-w-5 p-0 text-current')} onPress={() => { void close(id) }}><Icon name="close" size={12} /></Button>
        </div>)}
      </div>
      <Button isIconOnly aria-label="新建远端终端" variant="ghost" className={tw('size-7 min-w-7 p-0 text-current')} isDisabled={busy} onPress={() => { void create() }}><Icon name="plus" size={15} /></Button>
      {onClose && <Button isIconOnly aria-label="关闭终端面板" variant="ghost" className={tw('size-7 min-w-7 p-0 text-current')} onPress={onClose}><Icon name="close" size={15} /></Button>}
    </div>
    {error && <p role="alert" className={tw('m-0 px-3 py-1 text-xs text-red-300')}>{error}</p>}
    {selected ? <ServerTerminalScreen key={selected} service={service} taskId={taskId} terminalId={selected} />
      : <div className={tw('flex flex-1 items-center justify-center text-xs opacity-60')}>正在连接终端…</div>}
  </section>
}

function ServerTerminalScreen({ service, taskId, terminalId }: {
  readonly service: LingServerService
  readonly taskId: string
  readonly terminalId: string
}) {
  const element = useRef<HTMLDivElement>(null)
  const [message, setMessage] = useState<string>()
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', scrollback: 5000 })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.options.theme = { background: '#1b1b1e', foreground: '#e8e8e9', cursor: '#e8e8e9', selectionBackground: '#ffffff35' }
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
    return () => { stopped = true; if (timer) clearTimeout(timer); observer.disconnect(); input.dispose(); terminal.dispose() }
  }, [service, taskId, terminalId])
  return <div className={tw('flex min-h-0 flex-1 flex-col')}>
    {message && <p role="status" className={tw('m-0 px-3 py-1 text-xs text-amber-200')}>{message}</p>}
    <div ref={element} className={tw('min-h-0 flex-1 overflow-hidden px-3 py-2')} />
  </div>
}
