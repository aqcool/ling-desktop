import { useBehavior, updateBehavior } from './behavior-preferences.js'
import { CompactSelect, CompactSwitch, SettingsRow as SettingRow } from './SettingsControls.js'
import { CompactButton as Button } from './SettingsControls.js'
import { useState } from 'react'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

import { updateAppearance, useAppearance, type LingTheme, type LingPalette } from '../theme.js'
export type { LingTheme } from '../theme.js'

const palettes: readonly { id: LingPalette; label: string }[] = [
  { id: 'default', label: '默认' }, { id: 'forest', label: '森林' },
  { id: 'mint', label: '薄荷' }, { id: 'bee', label: '蜜蜂' }, { id: 'parchment', label: '羊皮纸' },
]

interface GeneralSettingsProps {
  readonly section: 'appearance' | 'shortcuts'
  readonly theme: LingTheme
  readonly onThemeChange: (theme: LingTheme) => void
  readonly version: string
  readonly localePreference: 'zh' | 'en' | undefined
  readonly localeLoading: boolean
  readonly localeMessage?: string
  readonly onLocaleChange: (preference: 'zh' | 'en' | undefined) => void
}

function SettingSelect({ label, value, options, onChange, disabled = false }: { readonly label: string; readonly value: string; readonly options: readonly { value: string; label: string }[]; readonly onChange: (value: string) => void; readonly disabled?: boolean }) {
  return <CompactSelect label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
}
function PreviewSelect({ label, value }: { label: string; value: string }) {
  return <CompactSelect label={label} value={value} options={[{ value, label: value }]} disabled onChange={() => {}} />
}
function PreviewToggle({ label }: { label: string }) {
  return <CompactSwitch label={label} selected={false} disabled />
}

const shortcutGroups = [
  { title: '输入', items: [
    { label: '发送消息', description: '发送当前输入；Shift Enter 换行。', keys: 'Enter' },
    { label: '关闭弹窗与搜索', description: '关闭当前打开的浮层。', keys: 'Esc' },
  ] },
  { title: '导航', items: [
    { label: '搜索任务', description: '打开任务搜索。', keys: '⌘ K' },
    { label: '打开或关闭左侧栏', description: '切换工作台左侧导航栏。', keys: '⌘ B' },
    { label: '打开内置浏览器', description: '在右侧新建浏览器标签页。', keys: '⌘ T' },
  ] },
  { title: '任务', items: [
    { label: '新任务', description: '在当前工作区创建任务。', keys: '⌘ N' },
  ] },
] as const

export function GeneralSettings({ section, theme, onThemeChange, version, localePreference, localeLoading, localeMessage, onLocaleChange }: GeneralSettingsProps) {
  const [shortcutQuery, setShortcutQuery] = useState('')
  const appearance = useAppearance()
  const behavior = useBehavior()
  if (section === 'shortcuts') {
    const normalizedQuery = shortcutQuery.trim().toLocaleLowerCase()
    const visibleGroups = shortcutGroups.map(group => ({
      ...group,
      items: group.items.filter(item => `${item.label} ${item.description} ${item.keys}`.toLocaleLowerCase().includes(normalizedQuery)),
    })).filter(group => group.items.length > 0)
    return <section aria-label="快捷键设置" className={tw("general-settings relative block max-w-3xl gap-3.5")}>
      <h1 className={tw("mt-0 mb-6 text-xl font-semibold text-[var(--foreground)]")}>快捷键</h1>
      <p className={tw("general-settings__intro mb-6 -mt-3 [color:var(--text-secondary)] [font-size:0.79rem]")}>搜索并查看 灵创当前支持的快捷键。</p>
      <h2 className={tw("mt-0 mb-3 text-[0.78rem] font-[580] text-[var(--text-secondary)]")}>应用快捷键</h2>
      <div className={tw("general-settings__list general-settings__search-card flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] px-4.5 py-4")}>
        <label className={tw("grid gap-1 text-[13px]")} htmlFor="settings-shortcut-search"><strong>搜索快捷键</strong><span className={tw("text-xs text-[var(--text-secondary)]")}>共 {shortcutGroups.reduce((total, group) => total + group.items.length, 0)} 个快捷键。</span></label>
        <input className={tw("min-h-8 w-[min(16rem,50%)] rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 py-1 text-[0.77rem] text-[var(--foreground)]")} id="settings-shortcut-search" onChange={event => { setShortcutQuery(event.target.value) }} placeholder="搜索命令、说明或组合键" type="search" value={shortcutQuery} />
      </div>
      {visibleGroups.map(group => <div className={tw("general-settings__group [margin-top:1.5rem]")} key={group.title}>
        <h2 className={tw("mt-0 mb-3 text-[0.78rem] font-[580] text-[var(--text-secondary)]")}>{group.title}</h2>
        <div className={tw("general-settings__list overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]")}>{group.items.map(item => <div className={tw("general-settings__shortcut mx-4.5 flex min-h-14 items-center justify-between gap-4  text-[0.8rem] last:border-b-0")} key={item.label}>
          <span className={tw("grid gap-1")}><strong className={tw("text-[13px] font-medium")}>{item.label}</strong><small className={tw("text-xs text-[var(--text-secondary)]")}>{item.description}</small></span><kbd className={tw("rounded-md border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-2 py-1 text-[0.72rem]")}>{item.keys}</kbd>
        </div>)}</div>
      </div>)}
      {visibleGroups.length === 0 ? <p className={tw("general-settings__status [margin:0.8rem_1rem_0] [color:var(--text-tertiary)] [font-size:0.75rem]")}>没有匹配的快捷键。</p> : null}
    </section>
  }

  return <section aria-label="外观设置" className={tw("general-settings w-full min-w-0 max-w-3xl pb-8")}>
    <h1 className={tw("mb-6 mt-0 text-xl font-semibold text-[var(--foreground)]")}>外观</h1>
    <div className={tw("mb-7 flex flex-wrap items-center justify-between gap-3")}>
      <h2 className={tw("m-0 text-[13px] font-medium")}>明暗模式</h2>
      <div aria-label="明暗模式" role="group" className={tw("flex gap-0.5 rounded-[10px] bg-[var(--surface-secondary)] p-1")}>
        {([{ id: 'system', label: '系统', icon: 'desktop' }, { id: 'light', label: '浅色', icon: 'sun' }, { id: 'dark', label: '深色', icon: 'moon' }] as const).map(mode => <Button key={mode.id} aria-pressed={theme === mode.id} onPress={() => { onThemeChange(mode.id) }} size="sm" variant="ghost" className={tw("h-8 min-h-8 gap-1.5 rounded-[7px] px-3 text-xs", theme === mode.id ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "bg-transparent text-[var(--text-secondary)]")}><Icon name={mode.icon} size={14} />{mode.label}</Button>)}
      </div>
    </div>
    <h2 className={tw("mb-3 mt-0 text-[13px] font-medium")}>界面主题</h2>
    <div aria-label="界面主题" role="group" className={tw("mb-7 grid grid-cols-5 gap-2.5 max-[1000px]:grid-cols-3")}>
      {palettes.map(palette => <Button key={palette.id} aria-label={`${palette.label}主题`} aria-pressed={appearance.palette === palette.id} onPress={() => { updateAppearance({ palette: palette.id }) }} variant="ghost" className={tw("h-auto w-full min-w-0 flex-col gap-2 rounded-xl border p-2 text-xs", appearance.palette === palette.id ? "border-[var(--focus)] ring-1 ring-[var(--focus)]" : "border-[var(--panel-border)] hover:border-[var(--text-tertiary)]")}>
        <span aria-hidden="true" data-palette={palette.id} data-theme={appearance.resolved} className={tw("flex h-16 w-full overflow-hidden rounded-md border border-[var(--panel-border)] bg-[var(--surface)]")}>
          <span className={tw("flex w-1/4 shrink-0 flex-col gap-1.5 bg-[var(--sidebar-background)] px-1.5 py-2")}><span className={tw("h-1 w-full rounded-full bg-[var(--text-tertiary)]/40")} /><span className={tw("h-1 w-2/3 rounded-full bg-[var(--text-tertiary)]/25")} /></span>
          <span className={tw("flex flex-1 flex-col gap-1.5 p-2")}><span className={tw("h-1 w-3/4 rounded-full bg-[var(--foreground)]/40")} /><span className={tw("h-1 w-full rounded-full bg-[var(--foreground)]/10")} /><span className={tw("mt-auto flex h-4 items-center justify-end rounded-sm border border-[var(--panel-border)] p-0.5")}><span className={tw("size-2 rounded-sm bg-[var(--focus)]")} /></span></span>
        </span>
        <span className={tw("flex h-5 items-center justify-center gap-1")} >{palette.label}{appearance.palette === palette.id ? <Icon name="check" size={12} /> : null}</span>
      </Button>)}
    </div>
    <div className={tw("general-settings__list overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)]")}>
      <SettingRow description="跟随界面明暗，或保留终端中手动选择的外观。" title="终端主题"><SettingSelect label="终端主题" onChange={value => { updateAppearance({ terminal: value === 'manual' ? 'manual' : 'follow' }) }} options={[{ value: 'follow', label: '跟随主题' }, { value: 'manual', label: '手动调整' }]} value={appearance.terminal} /></SettingRow>
      <SettingRow description="关闭时使用系统默认浏览器打开网页链接。" title="终端链接使用内置浏览器"><CompactSwitch label="终端链接使用内置浏览器" selected={behavior.terminalLinksInBrowser} onChange={terminalLinksInBrowser => updateBehavior({ terminalLinksInBrowser })} /></SettingRow>
      <SettingRow description="设置界面文字语言。" title="语言">
        <SettingSelect disabled={localeLoading} label="语言" onChange={value => { onLocaleChange(value === 'browser' ? undefined : value as 'zh' | 'en') }} options={[{ value: 'browser', label: '跟随浏览器' }, { value: 'zh', label: '简体中文' }, { value: 'en', label: 'English' }]} value={localePreference ?? 'browser'} />
      </SettingRow>
      <SettingRow description="选择界面字体的显示风格。" title="字体风格"><PreviewSelect label="字体风格" value="无衬线" /></SettingRow>
      <SettingRow description="调整任务内容和输入区的最大宽度。" title="内容宽度"><PreviewSelect label="内容宽度" value="标准" /></SettingRow>
      <SettingRow description="选择文件引用使用的图标风格。" title="文件图标"><PreviewSelect label="文件图标" value="默认" /></SettingRow>
      <SettingRow description="控制浮层和遮罩的模糊效果。" title="模糊与玻璃效果"><PreviewToggle label="模糊与玻璃效果" /></SettingRow>
    </div>
    <div className={tw("general-settings__group mt-6")}><h2 className={tw("mt-0 mb-3 text-[0.78rem] font-[580] text-[var(--text-secondary)]")}>应用图标</h2><div className={tw("general-settings__list overflow-hidden [border:1px_solid_var(--panel-border)] [border-radius:0.9rem] bg-[var(--surface)]")}>
      <SettingRow description="选择程序坞中显示的图标。" title="图标样式"><PreviewSelect label="图标样式" value="灵创" /></SettingRow>
    </div></div>
    {localeLoading ? <p className={tw("general-settings__status [margin:0.8rem_1rem_0] [color:var(--text-tertiary)] [font-size:0.75rem]")}>正在更新语言…</p> : null}
    {localeMessage ? <p className={tw("general-settings__error dark:[color:#ef968d] [margin:0.55rem_0_0] [color:#a6473f] [font-size:0.75rem]")} role="status">{localeMessage}</p> : null}
    <p className={tw("general-settings__version [margin:0.8rem_1rem_0] [color:var(--text-tertiary)] [font-size:0.75rem]")}>灵创 · {version} · 灰色控件仅展示界面，功能尚未接入</p>
  </section>
}
