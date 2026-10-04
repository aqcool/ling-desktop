import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export interface MonitorSections {
  readonly values: Readonly<Record<string, boolean>>
  readonly set: (title: string, open: boolean) => void
}

export const MonitorSectionsContext = createContext<MonitorSections | null>(null)

export function MonitorSection({ title, children, initiallyOpen = true, accessory }: {
  readonly title: string; readonly children: ReactNode; readonly initiallyOpen?: boolean; readonly accessory?: ReactNode
}) {
  const sections = useContext(MonitorSectionsContext)
  const [localOpen, setLocalOpen] = useState(initiallyOpen)
  const open = sections?.values[title] ?? localOpen
  const contentId = useId()
  return <section className={tw('task-monitor__section min-w-0 pb-3')}>
    <div className={tw('flex min-h-control min-w-0 items-center justify-between gap-2')}>
      <h3 className={tw('m-0 min-w-0 flex-1')}><button aria-controls={contentId} aria-expanded={open} className={tw('flex min-h-control w-full items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-left text-compact font-normal text-[var(--text-tertiary)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]')} onClick={() => { if (sections) sections.set(title, !open); else setLocalOpen(!open) }} type="button"><span>{title}</span><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /></button></h3>
      {accessory}
    </div>
    <div id={contentId} hidden={!open} className={tw('min-w-0 pb-1')}>{children}</div>
  </section>
}
