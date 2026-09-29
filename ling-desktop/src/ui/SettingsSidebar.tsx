import { useState } from 'react'
import { Icon } from './Icon.js'
import { settingsGroups, type LingSettingsTab } from './settings-navigation.js'
import { tw } from './tailwind.js'

interface SettingsSidebarProps {
  readonly selected: LingSettingsTab
  readonly onSelect: (tab: LingSettingsTab) => void
  readonly onReturn: () => void
}

export function SettingsSidebar({ selected, onSelect, onReturn }: SettingsSidebarProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return (
    <div className={tw("settings-sidebar flex min-h-0 flex-1 flex-col [padding:0_0.7rem_0.7rem] max-[700px]:[padding:0_0.3rem]")}>
      <button aria-label="返回应用" className={tw("settings-sidebar__return flex h-10 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] max-[700px]:justify-center")} onClick={onReturn} title="返回应用" type="button">
        <Icon name="arrowLeft" size={16} />
        <span className={tw("max-[700px]:hidden")}>返回应用</span>
      </button>
      <label className={tw("settings-sidebar__search mx-0.5 mt-2 mb-3 flex h-8.5 flex-none items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 text-[var(--text-tertiary)] focus-within:border-[var(--accent)] max-[700px]:justify-center max-[700px]:p-0")}>
        <Icon name="search" size={15} />
        <input className={tw("w-full min-w-0 border-0 bg-transparent text-[0.82rem] text-[var(--foreground)] outline-0 max-[700px]:hidden [&::-webkit-search-cancel-button]:cursor-pointer")} aria-label="搜索设置" onChange={event => { setQuery(event.target.value) }} placeholder="搜索设置…" type="search" value={query} />
      </label>
      <nav aria-label="设置导航" className={tw("settings-sidebar__navigation min-h-0 overflow-y-auto [padding:0_0.05rem_0.8rem] [scrollbar-width:thin]")}>
        {settingsGroups.map(group => {
          const items = group.items.filter(item =>
            normalizedQuery === '' || `${group.label} ${item.label}`.toLocaleLowerCase().includes(normalizedQuery),
          )
          if (items.length === 0) return null
          return (
            <div className={tw("settings-sidebar__group grid [gap:0.1rem] [margin-bottom:0.65rem]")} key={group.label}>
              <div className={tw("settings-sidebar__group-label [padding:0.3rem_0.55rem_0.2rem] [color:#b5b5b2] [font-size:0.75rem] [font-weight:400] [line-height:1.4] max-[700px]:hidden")}>{group.label}</div>
              {items.map(item => (
                <button
                  aria-current={selected === item.id ? 'page' : undefined}
                  aria-label={item.label}
                  className={tw("settings-sidebar__item flex min-h-7 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] max-[700px]:justify-center", selected === item.id && "settings-sidebar__item--active bg-[var(--surface-selected)] font-medium text-[var(--foreground)]")}
                  key={item.id}
                  onClick={() => { onSelect(item.id) }}
                  title={item.label}
                  type="button"
                >
                  <Icon className={tw("flex-none")} name={item.icon} size={16} />
                  <span className={tw("max-[700px]:hidden")}>{item.label}</span>
                </button>
              ))}
            </div>
          )
        })}
        {normalizedQuery && !settingsGroups.some(group => group.items.some(item => `${group.label} ${item.label}`.toLocaleLowerCase().includes(normalizedQuery)))
          ? <p className={tw("settings-sidebar__empty [padding:0_0.55rem] [color:var(--text-tertiary)] [font-size:0.78rem]")}>没有匹配的设置</p> : null}
      </nav>
    </div>
  )
}
