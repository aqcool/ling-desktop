import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { ListBox } from '@heroui/react/list-box'
import { Select } from '@heroui/react/select'
import { Switch } from '@heroui/react/switch'
import { tw } from './tailwind.js'

/** Compact desktop controls; HeroUI retains focus, keyboard and disabled behavior. */
export function CompactButton({ className, ...props }: Omit<ComponentProps<typeof Button>, 'className'> & { className?: string }) {
  return <Button size="sm" {...props} className={tw("h-control gap-1.5 rounded-lg px-3 text-xs", props.isIconOnly && 'size-8 min-w-0 shrink-0 p-0', className)} />
}

export function CompactInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'className'> & { className?: string }) {
  return <Input {...props} className={tw("h-control min-h-control min-w-0 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--foreground)] shadow-none", className)} />
}

export function CompactSelect({ label, value, options, onChange, disabled, className }: {
  label: string; value: string; options: readonly { value: string; label: string }[]
  onChange: (value: string) => void; disabled?: boolean; className?: string
}) {
  return <Select aria-label={label} value={value || null} placeholder="请选择" isDisabled={disabled || options.length === 0} onChange={(key: unknown) => { if (typeof key === 'string') onChange(key) }} variant="secondary" className={tw('w-40 min-w-0 max-w-full shrink-0', className)}>
    <Select.Trigger className={tw("h-control min-h-control gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--foreground)] shadow-none")}>
      <Select.Value className={tw('min-w-0 truncate')}>{options.find(option => option.value === value)?.label ?? '请选择'}</Select.Value><Select.Indicator className={tw('size-3.5 shrink-0 text-[var(--text-tertiary)]')} />
    </Select.Trigger>
    <Select.Popover className={tw('max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-1 shadow-lg')}>
      <ListBox className={tw('max-h-64 overflow-y-auto p-0')}>
        {options.map(option => <ListBox.Item id={option.value} key={option.value} textValue={option.label} className={tw("min-h-control gap-2 rounded-lg px-2 py-1.5 text-xs")}><span className={tw('min-w-0 flex-1 truncate')}>{option.label}</span><ListBox.ItemIndicator /></ListBox.Item>)}
      </ListBox>
    </Select.Popover>
  </Select>
}

export function CompactSwitch({ label, selected, onChange, disabled, title }: {
  label: string; selected: boolean; onChange?: (value: boolean) => void; disabled?: boolean; title?: string
}) {
  return <Switch aria-label={label} size="sm" isSelected={selected} onChange={onChange} isDisabled={disabled} title={title} className={tw('shrink-0')}>
    <Switch.Content aria-label={label} className={tw('min-h-8 items-center')}><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content>
  </Switch>
}

export function SettingsRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className={tw('mx-4 grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-3 max-[700px]:grid-cols-1')}>
    <div className={tw('min-w-0')}><h3 className={tw("m-0 text-compact font-medium text-[var(--foreground)]")}>{title}</h3>{description ? <p className={tw('mb-0 mt-1 text-xs leading-5 text-[var(--text-secondary)]')}>{description}</p> : null}</div>
    <div className={tw('flex min-w-0 items-center justify-end gap-2 max-[700px]:justify-start')}>{children}</div>
  </div>
}

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return <section className={tw('mb-6')}>
    {title ? <h2 className={tw('mb-3 mt-0 text-xs font-medium text-[var(--text-secondary)]')}>{title}</h2> : null}
    <div className={tw('rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]')}>{children}</div>
  </section>
}

export function SettingsHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <header className={tw('mb-6 flex flex-wrap items-start justify-between gap-3')}>
    <div className={tw('min-w-0')}><h1 className={tw('m-0 text-xl font-semibold text-[var(--foreground)]')}>{title}</h1>{description ? <p className={tw('mb-0 mt-1.5 text-xs leading-5 text-[var(--text-secondary)]')}>{description}</p> : null}</div>
    {children}
  </header>
}
