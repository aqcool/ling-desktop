import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Checkbox } from '@heroui/react/checkbox'
import { InputGroup } from '@heroui/react/input-group'
import { Modal } from '@heroui/react/modal'
import type { LingServer } from '../runtime/servers.js'
import { Icon } from './Icon.js'
import { CompactButton } from './SettingsControls.js'
import { tw } from './tailwind.js'

export function TaskServerPicker({ servers, serverIds, developmentServerId, revision, disabled, onApply, onManageServers }: {
  readonly servers: readonly LingServer[]
  readonly serverIds: readonly string[]
  readonly developmentServerId?: string
  readonly revision?: number
  readonly disabled?: boolean
  readonly onApply: (ids: readonly string[], expectedRevision?: number) => Promise<boolean>
  readonly onManageServers: () => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [baseRevision, setBaseRevision] = useState<number>()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const options: readonly LingServer[] = [...servers, ...serverIds.filter(id => !servers.some(server => server.id === id)).map(id => ({ id, name: '已移除的服务器', alias: id, environment: 'development' as const }))]
  const visible = options.filter(server => `${server.name} ${server.alias} ${server.user ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const apply = async () => {
    if (pending) return
    setPending(true); setError(undefined)
    try {
      const accepted = await onApply(selected, baseRevision)
      if (!mounted.current) return
      if (accepted) setOpen(false)
      else setError('关联服务器未保存，请重试。')
    } catch { if (mounted.current) setError('关联服务器未保存，请重试。') }
    finally { if (mounted.current) setPending(false) }
  }
  return <>
    <button aria-label="关联服务器" aria-haspopup="dialog" className={tw('inline-flex h-control-xs max-w-40 items-center gap-1 rounded-md border-0 bg-transparent px-1 text-xs text-inherit hover:bg-[var(--surface-hover)] disabled:opacity-50')} disabled={disabled} onClick={() => {
      setSelected([...new Set([...serverIds, ...(developmentServerId ? [developmentServerId] : [])])]); setBaseRevision(revision); setQuery(''); setError(undefined); setOpen(true)
    }} type="button"><Icon name="globe" size={14} /><span className={tw('truncate')}>关联服务器{serverIds.length ? ` · ${serverIds.length}` : ''}</span><Icon name="chevronDown" size={12} /></button>
    <Modal.Backdrop isOpen={open} isDismissable={!pending} isKeyboardDismissDisabled={pending} onOpenChange={(value: boolean) => { if (!pending) setOpen(value) }}>
      <Modal.Container size="md" placement="center" scroll="inside">
        <Modal.Dialog aria-label="关联服务器" className={tw('gap-4 rounded-2xl p-5')}>
          {!pending ? <Modal.CloseTrigger aria-label="关闭" /> : null}
          <Modal.Header className={tw('shrink-0 gap-1.5 pr-8')}>
            <Modal.Heading>关联服务器</Modal.Heading>
            <p className={tw('m-0 text-xs leading-5 text-[var(--text-secondary)]')}>可多选服务器，在此会话中使用其工具和终端。</p>
          </Modal.Header>
          <Modal.Body className={tw('mt-0 flex flex-col gap-3')}>
            <InputGroup fullWidth className={tw('h-control-lg min-h-control-lg shrink-0 rounded-lg')}>
              <InputGroup.Prefix><Icon name="search" size={16} /></InputGroup.Prefix>
              <InputGroup.Input aria-label="搜索服务器" autoFocus disabled={pending} value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="搜索名称或地址" className={tw('min-w-0 text-compact')} />
            </InputGroup>
            <div className={tw('flex shrink-0 items-center justify-between gap-3 text-xs text-[var(--text-secondary)]')}>
              <span>服务器</span>
              <span aria-live="polite" aria-atomic="true" className={tw('tabular-nums')}>已选 {selected.length} 台</span>
            </div>
            <div role="group" aria-label="可关联服务器" className={tw('grid min-h-0 max-h-72 shrink-0 grid-cols-1 gap-1 overflow-y-auto overscroll-contain')}>
              {visible.map(server => <Checkbox key={server.id} aria-label={server.name} isSelected={selected.includes(server.id)} isDisabled={pending || server.id === developmentServerId} onChange={(checked: boolean) => setSelected(current => checked ? [...current, server.id] : current.filter(id => id !== server.id))} className={tw('min-w-0 w-full rounded-xl border border-transparent data-[selected=true]:border-[var(--panel-border)] data-[selected=true]:bg-[var(--surface-secondary)]')}>
                <Checkbox.Content className={tw('min-h-16 min-w-0 w-full gap-3 rounded-xl px-3 py-2.5 hover:bg-[var(--surface-hover)]')}>
                  <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                  <span className={tw('flex min-w-0 flex-1 flex-col gap-1')}>
                    <span className={tw('break-words text-compact leading-5')}>{server.name}</span>
                    <span className={tw('truncate text-xs font-normal text-[var(--text-secondary)]')} title={`${server.user ? `${server.user}@` : ''}${server.alias}`}>{server.user ? `${server.user}@` : ''}{server.alias}</span>
                  </span>
                  {server.id === developmentServerId ? <span className={tw('shrink-0 rounded-md bg-[var(--surface-tertiary)] px-1.5 py-1 text-caption font-normal text-[var(--text-secondary)]')}>主工程</span> : null}
                </Checkbox.Content>
              </Checkbox>)}
              {!visible.length ? <p className={tw('m-0 rounded-xl bg-[var(--surface-secondary)] px-3 py-8 text-center text-xs text-[var(--text-secondary)]')}>{servers.length ? '没有匹配的服务器' : '尚未配置服务器'}</p> : null}
            </div>
            {developmentServerId ? <p className={tw('m-0 text-xs leading-5 text-[var(--text-secondary)]')}>主工程服务器保持关联，运行位置不随关联列表改变。</p> : null}
            {error ? <p role="alert" className={tw('m-0 text-xs leading-5 text-[var(--danger)]')}>{error}</p> : null}
          </Modal.Body>
          <Modal.Footer className={tw('mt-0 shrink-0 flex-wrap justify-between gap-3 border-t border-[var(--panel-border)] pt-4')}>
            <CompactButton variant="ghost" className={tw('-ml-2 px-2')} isDisabled={pending} onPress={() => { setOpen(false); onManageServers() }}>管理服务器</CompactButton>
            <div className={tw('ml-auto flex shrink-0 items-center gap-2')}>
              <CompactButton variant="ghost" className={tw('min-w-16')} isDisabled={pending} onPress={() => setOpen(false)}>取消</CompactButton>
              <CompactButton variant="primary" className={tw('min-w-16')} isPending={pending} onPress={() => { void apply() }}>应用</CompactButton>
            </div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </>
}
