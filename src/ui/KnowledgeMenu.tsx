import { Dropdown } from '@heroui/react/dropdown'
import { Label } from '@heroui/react/label'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'
export function KnowledgeMenu({
  label = '更多操作',
  text,
  items,
  className,
  disabled = false,
}: {
  label?: string
  text?: string
  className?: string
  disabled?: boolean
  items: { id: string; label: string; action: () => void; danger?: boolean }[]
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={label}
        isDisabled={disabled}
        className={tw(
          text
            ? 'flex h-8 min-w-0 items-center justify-center gap-2 rounded-lg border-0 bg-[var(--surface-secondary)] px-3 text-xs text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
            : 'flex size-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
          className,
        )}
      >
        <Icon name={text ? 'plus' : 'more'} size={text ? 14 : 17} />
        {text}
      </Dropdown.Trigger>
      <Dropdown.Popover
        placement="bottom end"
        className={tw(
          'min-w-44 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-1 shadow-[var(--overlay-shadow)]',
        )}
      >
        <Dropdown.Menu
          aria-label={label}
          onAction={(key: unknown) =>
            items.find((item) => item.id === String(key))?.action()
          }
        >
          {items.map((item) => (
            <Dropdown.Item
              key={item.id}
              id={item.id}
              textValue={item.label}
              variant={item.danger ? 'danger' : undefined}
              className={tw('rounded-lg px-3 py-2 text-xs')}
            >
              <Label>{item.label}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
