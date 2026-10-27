import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Checkbox } from '@heroui/react/checkbox'
import { Input } from '@heroui/react/input'
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
    <Modal.Backdrop isOpen={open} isDismissable={!pending} isKeyboardDismissDisabled={pending} onOpenChange={(value: boolean) => { if (!pending) setOpen(value) }}><Modal.Container size="sm"><Modal.Dialog aria-label="关联服务器">
      {!pending ? <Modal.CloseTrigger /> : null}
      <Modal.Header><Modal.Heading>关联服务器</Modal.Heading><p className={tw('mb-0 mt-1 text-xs text-[var(--text-secondary)]')}>此会话可使用已关联服务器的工具和终端。</p></Modal.Header>
      <Modal.Body className={tw('gap-3')}>
        <Input aria-label="搜索服务器" autoFocus value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="搜索名称或地址" className={tw('h-control rounded-lg text-compact')} />
        <div role="group" aria-label="可关联服务器" className={tw('grid max-h-72 gap-1 overflow-y-auto')}>
          {visible.map(server => <Checkbox key={server.id} aria-label={server.name} isSelected={selected.includes(server.id)} isDisabled={pending || server.id === developmentServerId} onChange={(checked: boolean) => setSelected(current => checked ? [...current, server.id] : current.filter(id => id !== server.id))}>
            <Checkbox.Content className={tw('min-h-11 w-full gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)]')}><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span className={tw('flex min-w-0 flex-1 flex-col gap-0.5')}><span className={tw('truncate text-compact')}>{server.name}{server.id === developmentServerId ? <small className={tw('ml-2 text-caption text-[var(--text-secondary)]')}>主工程</small> : null}</span><span className={tw('truncate text-xs text-[var(--text-tertiary)]')}>{server.user ? `${server.user}@` : ''}{server.alias}</span></span></Checkbox.Content>
          </Checkbox>)}
          {!visible.length ? <p className={tw('py-4 text-center text-xs text-[var(--text-tertiary)]')}>{servers.length ? '没有匹配的服务器' : '尚未配置服务器'}</p> : null}
        </div>
        {developmentServerId ? <p className={tw('m-0 text-xs text-[var(--text-tertiary)]')}>主工程服务器保持关联，运行位置不随关联列表改变。</p> : null}
        {error ? <p role="alert" className={tw('m-0 text-xs text-[var(--danger)]')}>{error}</p> : null}
      </Modal.Body>
      <Modal.Footer className={tw('flex-wrap')}><CompactButton variant="ghost" isDisabled={pending} onPress={() => { setOpen(false); onManageServers() }}>管理服务器</CompactButton><span className={tw('flex-1')} /><CompactButton variant="ghost" isDisabled={pending} onPress={() => setOpen(false)}>取消</CompactButton><CompactButton variant="primary" isPending={pending} onPress={() => { void apply() }}>应用{selected.length ? `（${selected.length}）` : ''}</CompactButton></Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </>
}
