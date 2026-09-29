import { CompactSelect, CompactSwitch, SettingsRow as Row, SettingsGroup as Group, SettingsHeader } from './SettingsControls.js'
import { useState } from 'react'
import { CompactButton as Button } from './SettingsControls.js'
import { TextArea } from '@heroui/react/textarea'
import { TextField } from '@heroui/react/textfield'
import { defaultBehavior, updateBehavior, useBehavior, type BehaviorPreferences, type ModePreferences, type WorkMode } from './behavior-preferences.js'
import { tw } from './tailwind.js'

export interface NativeBehavior {
  onOpenTask(callback: (taskId: string) => void): () => void
  setTray(value: boolean): Promise<void>
  notify(value: { key: string; title: string; body: string; taskId: string; backgroundOnly: boolean }): Promise<void>
}
export function nativeBehavior(): NativeBehavior | undefined {
  return typeof window === 'undefined' ? undefined : (window as Window & { __LING_BEHAVIOR__?: NativeBehavior }).__LING_BEHAVIOR__
}
function Toggle({ title, value, onChange, disabled }: { title: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <CompactSwitch label={title} selected={value} onChange={onChange} disabled={disabled} />
}
function Select({ title, value, options, onChange, disabled }: { title: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <CompactSelect label={title} value={value} options={options.map(([value, label]) => ({ value, label }))} onChange={onChange} disabled={disabled} />
}
export function BehaviorSettings({ section, supportsGoalLimit = false }: { section: 'general' | 'modes'; supportsGoalLimit?: boolean }) {
  const preferences = useBehavior()
  const [error, setError] = useState('')
  const [editingPhrases, setEditingPhrases] = useState(false)
  const [phrases, setPhrases] = useState('')
  const [nativePending, setNativePending] = useState(false)
  const save = (patch: Partial<BehaviorPreferences>) => { try { updateBehavior(patch); setError(''); return true } catch { setError('设置未能保存，请重试。'); return false } }
  const setMode = (mode: WorkMode, patch: Partial<ModePreferences>) => save({ modes: { ...preferences.modes, [mode]: { ...preferences.modes[mode], ...patch } } })
  const booleanRow = (key: 'readingStart' | 'toolCounts' | 'expandTools' | 'collapseProcess', title: string, description: string) => <Row title={title} description={description}><Toggle title={title} value={preferences[key]} onChange={value => save({ [key]: value })} /></Row>
  return <section aria-label={section === 'general' ? '常规设置' : '模式配置'} className={tw('w-full max-w-3xl pb-8')}>
    <SettingsHeader title={section === 'general' ? '常规' : '模式配置'} />
    {error ? <p role="alert" className={tw('text-xs text-[var(--danger)]')}>{error}</p> : null}
    {section === 'modes' ? <>
      <Group title="当前模式"><Row title="工作模式" description="调整界面展示，不改变任务权限和模型。"><Select title="工作模式" value={preferences.workMode} options={[["coding", "编程"], ["general", "通用"]]} onChange={value => save({ workMode: value as WorkMode })} /></Row></Group>
      {(['coding', 'general'] as const).map(mode => <Group key={mode} title={mode === 'coding' ? '编程' : '通用'}>
        <Row title="绑定主题" description="切换到此模式时应用。"><Select title={`${mode === 'coding' ? '编程' : '通用'}绑定主题`} value={preferences.modes[mode].palette} options={[["inherit", "保持当前主题"], ["default", "默认"], ["forest", "森林"], ["mint", "薄荷"], ["bee", "蜜蜂"], ["parchment", "羊皮纸"]]} onChange={value => setMode(mode, { palette: value as ModePreferences['palette'] })} /></Row>
        {([
          ['locationControls', '运行位置入口', '显示工作区选择、分支菜单和外部应用入口。'],
          ['environmentLabels', '输入区运行环境标签', '在输入框下方显示工作区、运行位置和分支。'],
          ['monitorEnvironment', '任务监控卡片环境信息', '显示仓库变化、运行位置和提交入口。'],
          ['localServices', '浏览器本地服务入口', '在浏览器空白页显示本地地址。'],
          ['fileChanges', '任务文件变更卡片', '在聊天中显示本轮文件变更与审阅入口。'],
        ] as const).map(([key, title, description]) => <Row key={key} title={title} description={description}><Toggle title={`${mode === 'coding' ? '编程' : '通用'}${title}`} value={preferences.modes[mode][key]} onChange={value => setMode(mode, { [key]: value })} /></Row>)}
      </Group>)}
    </> : <>
      <Group title="任务与工具">
        <Row title="运行中发送方式" description="Agent 执行期间，新输入默认排队或立即插话。"><Select title="运行中发送方式" value={preferences.sendMode} options={[["queue", "排队"], ["steer", "立即插话"]]} onChange={value => save({ sendMode: value as 'queue' | 'steer' })} /></Row>
        <Row title="问答面板静默跳过" description="仅跳过无人操作的普通问答；填写回答后停止计时。审批和计划审阅始终等待确认。"><Select title="问答面板静默跳过" value={String(preferences.questionTimeout)} options={[["0", "关闭"], ["60", "1 分钟"], ["120", "2 分钟"], ["300", "5 分钟"]]} onChange={value => save({ questionTimeout: Number(value) })} /></Row>
        <Row title="产物文件默认打开位置" description="运行时尚未提供独立产物文件入口。"><Select title="产物文件默认打开位置" value="right" options={[["right", "右侧工作区"]]} onChange={() => {}} disabled /></Row>
        <Row title="提示建议" description="运行时尚未提供后续提问建议。"><Toggle title="提示建议" value={false} onChange={() => {}} disabled /></Row>
        {booleanRow('readingStart', '新消息保持在阅读起点', '发送后将新一轮定位到视口顶部，保留阅读位置。')}
        {booleanRow('toolCounts', '显示工具调用次数', '在折叠的处理过程前显示工具调用数量。')}
        {booleanRow('expandTools', '默认展开工具调用', '自动展开工具组及输入与响应，仍可手动收起。')}
        {booleanRow('collapseProcess', '折叠回复过程', '本轮完成后收起过程消息，保留最终回复。')}
        <Row title="耗时显示格式" description="设置当前轮次计时的显示精度。"><Select title="耗时显示格式" value={preferences.elapsedFormat} options={[["seconds", "整数秒"], ["clock", "分:秒"], ["precise", "精确到 0.1 秒"]]} onChange={value => save({ elapsedFormat: value as BehaviorPreferences['elapsedFormat'] })} /></Row>
        <Row title="思考状态 Loader" description="选择等待回复时的加载动效。"><Select title="思考状态 Loader" value={preferences.thinkingLoader} options={[["matrix", "点阵"], ["spinner", "旋转"], ["dots", "跳动圆点"], ["none", "无"]]} onChange={value => save({ thinkingLoader: value as BehaviorPreferences['thinkingLoader'] })} /></Row>
        <Row title="思考状态文案" description="每行一条，每 4 秒轮换。"><Button size="sm" variant="secondary" className={tw('h-8 rounded-md text-xs')} onPress={() => { setPhrases(preferences.thinkingPhrases.join('\n')); setEditingPhrases(value => !value) }}>编辑文案</Button></Row>
        {editingPhrases ? <div className={tw('grid gap-2 px-4 pb-4')}><TextField aria-label="思考状态文案" value={phrases} onChange={setPhrases}><TextArea className={tw('min-h-24 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] text-xs')} /></TextField><div className={tw('flex justify-end gap-2')}><Button size="sm" variant="ghost" onPress={() => setPhrases(defaultBehavior.thinkingPhrases.join('\n'))}>恢复默认</Button><Button size="sm" isDisabled={!phrases.trim()} onPress={() => { if (save({ thinkingPhrases: phrases.split('\n') })) setEditingPhrases(false) }}>保存</Button></div></div> : null}
        <Row title="目标驱动执行" description={supportsGoalLimit ? '新建目标的最大执行轮次，不影响已有目标。' : '当前运行时尚未提供目标轮次配置。'}><Select title="目标驱动执行" value={String(preferences.goalRounds)} options={[["5", "5 轮"], ["10", "10 轮"], ["20", "20 轮"], ["50", "50 轮"], ["100", "100 轮"], ["256", "256 轮"]]} onChange={value => save({ goalRounds: Number(value) })} disabled={!supportsGoalLimit} /></Row>
      </Group>
      <Group title="通知">
        <Row title="轮次完成通知" description="任务完成或失败时发送系统通知。"><Select title="轮次完成通知" value={preferences.completionNotification} options={[["off", "关闭"], ["background", "仅在未聚焦时"], ["always", "始终"]]} onChange={value => save({ completionNotification: value as BehaviorPreferences['completionNotification'] })} disabled={!nativeBehavior()} /></Row>
        <Row title="权限请求通知" description="任务等待工具审批时通知。"><Toggle title="权限请求通知" value={preferences.approvalNotification} onChange={value => save({ approvalNotification: value })} disabled={!nativeBehavior()} /></Row>
        <Row title="等待回答通知" description="出现新问答或计划审阅时通知。"><Toggle title="等待回答通知" value={preferences.questionNotification} onChange={value => save({ questionNotification: value })} disabled={!nativeBehavior()} /></Row>
        {!nativeBehavior() ? <p className={tw('mx-4 mb-3 text-xs text-[var(--text-tertiary)]')}>系统通知需要新版桌面客户端。</p> : null}
      </Group>
      <Group title="托盘与菜单栏"><Row title="显示菜单栏图标" description="在系统托盘或 macOS 菜单栏显示灵创入口。"><Toggle title="显示菜单栏图标" value={preferences.tray} disabled={!nativeBehavior() || nativePending} onChange={value => { setNativePending(true); void nativeBehavior()?.setTray(value).then(() => save({ tray: value }), () => setError('无法更新菜单栏图标。')).finally(() => setNativePending(false)) }} /></Row></Group>
    </>}
  </section>
}
