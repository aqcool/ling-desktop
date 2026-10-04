import { useState } from 'react'
import { Button } from '@heroui/react/button'
import { Popover } from '@heroui/react/popover'
import { ListBox } from '@heroui/react/list-box'
import type { Selection } from 'react-aria-components'
import type { LingTaskAgentPreset } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export function AgentPresetPicker({ catalog, value, editable, loading, pending, error, onSelect, onRetry }: {
  catalog?: LingTaskAgentPreset
  value?: string
  editable: boolean
  loading: boolean
  pending: boolean
  error?: string
  onSelect: (id: string) => void
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const current = catalog?.modeSelectionEnabled === false ? catalog.currentValue : value ?? catalog?.currentValue
  const selected = catalog?.options.find(option => option.id === current)
  const label = selected?.label ?? current ?? '智能体'
  const content = <><Icon name="robot" size={14} /><span className={tw('truncate')}>{label}</span></>
  if (loading || pending) return <span role="status" className={tw("inline-flex h-control-xs shrink-0 items-center gap-1.5 text-xs text-[var(--text-tertiary)]")}><Icon name="robot" size={14} />{pending ? '正在切换…' : '读取智能体…'}</span>
  if (error) return <button type="button" aria-label="重试读取智能体" onClick={onRetry} title={error} className={tw("inline-flex h-control-xs items-center gap-1.5 rounded-md px-1 text-xs text-[var(--danger)] hover:bg-[var(--surface-hover)]")}><Icon name="refresh" size={14} />智能体读取失败</button>
  if (!catalog?.options.length && !current) return null
  if (catalog?.modeSelectionEnabled === false) return <span className={tw("inline-flex h-control-xs items-center gap-1.5 px-1 text-xs text-muted")}>{content}</span>
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Button aria-label={editable ? '选择智能体' : '在新任务中选择智能体'} className={tw("h-control-xs min-w-0 max-w-40 gap-1.5 rounded-md px-1 text-xs text-[var(--text-secondary)]")} size="sm" variant="ghost">
      {content}<Icon name="chevronDown" size={11} />
    </Button>
    <Popover.Content placement="top start" offset={6} className={tw('w-72 max-w-[calc(100vw-16px)] rounded-xl border border-[var(--panel-border)]')}>
      <Popover.Dialog aria-label="智能体选择" className={tw('p-1')}>
        {!editable ? <div className={tw('px-2 py-2')}><Popover.Heading className={tw('text-xs')}>在新任务中使用</Popover.Heading><p className={tw('mt-1 mb-0 text-xs text-muted')}>已开始的会话无法更换智能体，原会话会保留。</p></div> : null}
        <ListBox
          aria-label="智能体列表"
          className={tw('max-h-80 overflow-y-auto p-0.5 [scrollbar-width:thin]')}
          items={catalog?.options ?? []}
          selectionMode="single"
          selectedKeys={current ? [current] : []}
          disabledKeys={catalog?.options.filter(option => option.unavailableReason !== undefined).map(option => option.id)}
          disallowEmptySelection
          onSelectionChange={(keys: Selection) => {
            if (keys === 'all') return
            const id = [...keys][0]
            if (typeof id !== 'string') return
            setOpen(false)
            onSelect(id)
          }}
        >
          {(option: LingTaskAgentPreset['options'][number]) => <ListBox.Item id={option.id} textValue={option.label} title={option.unavailableReason ?? option.description} className={tw('items-start gap-2 rounded-lg px-2 py-2')}>
            <Icon name="robot" size={16} className={tw('mt-0.5 shrink-0 text-muted')} />
            <span className={tw('min-w-0 flex-1')}>
              <span className={tw("flex items-center gap-2 text-compact font-medium")}><span className={tw('truncate')}>{option.label}</span>{option.isDefault ? <span className={tw("text-micro font-normal text-muted")}>默认</span> : null}</span>
              {option.unavailableReason || option.description ? <span className={tw('mt-0.5 line-clamp-2 block text-xs leading-4 text-muted')}>{option.unavailableReason ?? option.description}</span> : null}
            </span>
            <ListBox.ItemIndicator />
          </ListBox.Item>}
        </ListBox>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>
}
