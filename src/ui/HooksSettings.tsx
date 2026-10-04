import { useEffect, useState, type ChangeEvent } from 'react'
import { hooksForDialect, type LingHookEntry, type LingHookSettings, type LingHooksService, type LingHooksSnapshot } from '../runtime/hooks.js'
import { CompactButton, CompactInput, CompactSelect, CompactSwitch, SettingsGroup, SettingsHeader, SettingsRow } from './SettingsControls.js'
import { tw } from './tailwind.js'

const eventLabels: Record<LingHookEntry['event'], string> = { SessionStart: '会话开始', UserPromptSubmit: '提交提示词', PreToolUse: '工具执行前', PostToolUse: '工具执行后', Stop: '回合停止', SubagentStart: '子任务开始', SubagentStop: '子任务停止' }
const hasMatcher = (event: LingHookEntry['event']) => event !== 'UserPromptSubmit' && event !== 'Stop'
function same(left: LingHookSettings | undefined, right: LingHookSettings | undefined) { return JSON.stringify(left) === JSON.stringify(right) }
function newEntry(): LingHookEntry { return { id: globalThis.crypto?.randomUUID?.() ?? `hook-${Date.now()}-${Math.random().toString(16).slice(2)}`, event: 'PreToolUse', command: '', matcher: '', timeoutSec: 600, enabled: true } }

export function HooksSettings({ service, onOpenTask }: { service?: LingHooksService; onOpenTask?: (taskId: string) => void }) {
  const [snapshot, setSnapshot] = useState<LingHooksSnapshot>()
  const [draft, setDraft] = useState<LingHookSettings>()
  const [draftRevision, setDraftRevision] = useState(0)
  const [editor, setEditor] = useState<LingHookEntry>()
  const [path, setPath] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setSnapshot(undefined); setDraft(undefined); setEditor(undefined); setError('')
    if (!service) return
    let active = true, initial = true
    const controller = new AbortController()
    const read = async () => {
      let result
      try { result = await service.request({ type: 'snapshot' }, controller.signal) } catch (error) { if (active) setError(error instanceof Error ? error.message : '无法读取 Hooks。'); return }
      if (!active) return
      if (!result.ok) { setError(result.message); return }
      if (result.value.snapshot) {
        const received = result.value.snapshot
        setSnapshot(current => current && current.revision > received.revision ? current : received)
        if (initial) { setDraft(result.value.snapshot.settings); setDraftRevision(result.value.snapshot.revision); initial = false }
      }
    }
    void read()
    const timer = setInterval(() => { void read() }, 5000)
    return () => { active = false; controller.abort(); clearInterval(timer) }
  }, [service])
  const change = (patch: Partial<LingHookSettings>) => { if (draft) setDraft({ ...draft, ...patch }); setNotice('') }
  const apply = async () => {
    if (!service || !draft || !snapshot) return
    setWorking(true); setError(''); setNotice('')
    try {
      const result = await service.request({ type: 'save', revision: draftRevision, settings: draft })
      if (!result.ok) { setError(result.message); return }
      if (result.value.snapshot) { setSnapshot(result.value.snapshot); setDraft(result.value.snapshot.settings); setDraftRevision(result.value.snapshot.revision); setNotice('配置已保存并应用。') }
    } catch (error) { setError(error instanceof Error ? error.message : '无法应用配置。') } finally { setWorking(false) }
  }
  const importFile = async () => {
    if (!service || !draft) return
    setWorking(true); setError(''); setNotice('')
    try {
      const result = await service.request({ type: 'import', path, dialect: draft.dialect })
      if (!result.ok) { setError(result.message); return }
      if (result.value.imported) { change({ entries: result.value.imported }); setEditor(undefined); setNotice(`已读取 ${result.value.imported.length} 个 command Hooks，保存后生效。`) }
    } catch (error) { setError(error instanceof Error ? error.message : '无法读取配置。') } finally { setWorking(false) }
  }
  const saveEditor = () => {
    if (!draft || !editor) return
    if (!editor.command.trim()) { setError('请输入要执行的命令。'); return }
    if (!Number.isInteger(editor.timeoutSec) || editor.timeoutSec < 1 || editor.timeoutSec > 600) { setError('超时应为 1–600 秒。'); return }
    const edited = { ...editor, command: editor.command.trim(), matcher: hasMatcher(editor.event) ? editor.matcher : '' }
    change({ entries: draft.entries.some(entry => entry.id === editor.id) ? draft.entries.map(entry => entry.id === editor.id ? edited : entry) : [...draft.entries, edited] })
    setEditor(undefined); setError('')
  }
  return <section aria-label="钩子设置" className={tw('w-full min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title="钩子" description="在任务的指定时刻运行本机命令。配置作用于当前 LING Host 的所有任务，命令在各任务工作目录执行。">
      <CompactButton variant="ghost" isDisabled={!snapshot || working || same(draft, snapshot.settings)} onPress={() => { if (snapshot) { setDraft(snapshot.settings); setDraftRevision(snapshot.revision); setEditor(undefined); setError(''); setNotice('') } }}>还原</CompactButton>
      <CompactButton variant="primary" isDisabled={!draft || !snapshot || working || !!editor || (same(draft, snapshot.settings) && snapshot.state !== 'error')} isPending={working} onPress={() => { void apply() }}>保存并应用</CompactButton>
    </SettingsHeader>
    {error ? <p role="alert" className={tw('mb-4 text-xs leading-5 text-[var(--danger)]')}>{error}</p> : null}
    {notice ? <p role="status" className={tw('mb-4 text-xs text-[var(--text-secondary)]')}>{notice}</p> : null}
    {!service ? <p className={tw('text-xs text-[var(--text-secondary)]')}>连接 LING 本机运行时后可管理 Hooks。</p> : !draft || !snapshot ? <p role="status" className={tw('text-xs text-[var(--text-secondary)]')}>{error ? '暂时无法读取 Hooks。' : '正在读取 Hooks…'}</p> : <>
      <SettingsGroup>
        <SettingsRow title="启用 Hooks" description={snapshot.busy ? '有任务正在运行。可以编辑草稿，全部任务结束后再应用。' : '保存时立即加载。应用期间保留任务、连接与排队输入。'}><CompactSwitch label="启用 Hooks" selected={draft.enabled} disabled={working} onChange={enabled => change({ enabled })} /></SettingsRow>
        <SettingsRow title="配置格式" description="仅支持同步 command 类型；不自动读取项目中的配置。"><CompactSelect label="Hooks 配置格式" value={draft.dialect} disabled={working || !!editor} options={[{ value: 'claude-code', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} onChange={value => change({ dialect: value as LingHookSettings['dialect'] })} /></SettingsRow>
        <div className={tw('mx-4 border-t border-[var(--panel-border)] py-3 text-xs leading-5 text-[var(--text-secondary)]')}>
          <span>{snapshot.state === 'loaded' ? `已加载 · ${snapshot.activeCount} 个 Hooks` : snapshot.state === 'error' ? '加载失败' : '已停用'}</span>{!same(draft, snapshot.settings) ? <span className={tw('ml-2 text-[var(--accent)]')}>有未应用的修改</span> : null}
          {snapshot.error ? <p role="alert" className={tw('my-1 text-[var(--danger)]')}>{snapshot.error}</p> : null}
          <div className={tw('mt-1 break-all text-[var(--text-tertiary)]')}>{snapshot.configPath}</div>
        </div>
      </SettingsGroup>
      <SettingsGroup title="已配置的 Hooks">
        <div className={tw('mx-4 flex items-center justify-between gap-2 py-3')}><span className={tw('text-xs text-[var(--text-secondary)]')}>{draft.entries.length} 个命令</span><CompactButton variant="secondary" isDisabled={working || !!editor || draft.entries.length >= 100} onPress={() => setEditor(newEntry())}>添加 Hook</CompactButton></div>
        {draft.entries.map(entry => <div key={entry.id} className={tw('mx-4 flex items-center gap-3 border-t border-[var(--panel-border)] py-3')}>
          <CompactSwitch label={`${eventLabels[entry.event]} Hook`} selected={entry.enabled} disabled={working || !!editor} onChange={enabled => change({ entries: draft.entries.map(item => item.id === entry.id ? { ...item, enabled } : item) })} />
          <div className={tw('min-w-0 flex-1')}><div className={tw('text-xs font-medium')}>{eventLabels[entry.event]}<span className={tw('ml-2 font-normal text-[var(--text-tertiary)]')}>{entry.event}{entry.matcher ? ` · ${entry.matcher}` : ''} · {entry.timeoutSec} 秒</span></div><code title={entry.command} className={tw('mt-1 block truncate text-xs text-[var(--text-secondary)]')}>{entry.command}</code></div>
          <CompactButton variant="ghost" isDisabled={working || !!editor} onPress={() => setEditor({ ...entry })}>编辑</CompactButton><CompactButton variant="ghost" isDisabled={working || !!editor} onPress={() => change({ entries: draft.entries.filter(item => item.id !== entry.id) })}>移除</CompactButton>
        </div>)}
        {!draft.entries.length && !editor ? <p className={tw('mx-4 mb-4 mt-0 text-xs leading-5 text-[var(--text-secondary)]')}>还没有 Hooks。添加命令，或导入现有配置。</p> : null}
        {editor ? <div className={tw('mx-4 mb-4 grid gap-3 rounded-lg border border-[var(--panel-border)] bg-[var(--surface-subtle)] p-3')}>
          <div className={tw('flex flex-wrap items-center gap-3')}><CompactSelect label="Hook 事件" value={editor.event} options={hooksForDialect(draft.dialect).map(event => ({ value: event, label: eventLabels[event] }))} onChange={event => setEditor({ ...editor, event: event as LingHookEntry['event'] })} /><CompactInput aria-label="Hook 超时秒数" type="number" min={1} max={600} value={String(editor.timeoutSec)} onChange={(event: ChangeEvent<HTMLInputElement>) => setEditor({ ...editor, timeoutSec: Number(event.target.value) })} className={tw('w-24')} /><span className={tw('text-xs text-[var(--text-secondary)]')}>秒</span></div>
          {hasMatcher(editor.event) ? <CompactInput aria-label="Hook 匹配表达式" placeholder="匹配表达式（留空匹配全部）" value={editor.matcher} onChange={(event: ChangeEvent<HTMLInputElement>) => setEditor({ ...editor, matcher: event.target.value })} /> : null}
          <CompactInput aria-label="Hook 命令" placeholder="命令或脚本绝对路径" value={editor.command} onChange={(event: ChangeEvent<HTMLInputElement>) => setEditor({ ...editor, command: event.target.value })} />
          <p className={tw('m-0 text-xs leading-5 text-[var(--text-secondary)]')}>事件 JSON 通过标准输入传入命令。命令按当前用户权限执行；用绝对路径调用脚本，可避免工作目录变化。</p>
          <div className={tw('flex justify-end gap-2')}><CompactButton variant="ghost" onPress={() => setEditor(undefined)}>取消</CompactButton><CompactButton variant="secondary" onPress={saveEditor}>加入配置</CompactButton></div>
        </div> : null}
      </SettingsGroup>
      <SettingsGroup title="导入已有配置"><div className={tw('mx-4 grid gap-3 py-4')}>
        <p className={tw('m-0 text-xs leading-5 text-[var(--text-secondary)]')}>读取所选格式的 hooks.json 或含 hooks 的 settings.json。读取会替换页面草稿，原文件保留。</p>
        <div className={tw('flex gap-2 max-[700px]:flex-col')}><CompactInput aria-label="Hooks 配置文件路径" placeholder="JSON 文件绝对路径" value={path} onChange={(event: ChangeEvent<HTMLInputElement>) => setPath(event.target.value)} className={tw('flex-1')} /><CompactButton variant="secondary" isDisabled={working || !!editor || !path.trim()} onPress={() => { void importFile() }}>读取配置</CompactButton></div>
      </div></SettingsGroup>
      <SettingsGroup title="最近执行"><div className={tw('mx-4 py-3')}>
        <p className={tw('mb-3 mt-0 text-xs text-[var(--text-tertiary)]')}>当前 Host 进程最近 50 次回合内执行；完整记录保存在对应任务日志。</p>
        {snapshot.history.length ? snapshot.history.map((run, index) => <div key={`${run.taskId}:${run.handlerId}:${index}`} className={tw('flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--panel-border)] py-2 text-xs')}>
          <span className={tw('text-[var(--text-tertiary)]')}>{new Date(run.time).toLocaleTimeString()}</span><span>{run.point}</span><span className={tw('text-[var(--text-secondary)]')}>{run.decision} · {Math.round(run.durationMs)} ms{run.exitCode !== undefined ? ` · exit ${run.exitCode}` : ''}</span>
          {onOpenTask ? <CompactButton variant="ghost" className={tw('ml-auto')} onPress={() => onOpenTask(run.taskId)}>查看任务</CompactButton> : null}
          {run.stderrSummary ? <p className={tw('m-0 w-full break-words text-[var(--text-secondary)]')}>{run.stderrSummary}</p> : null}
        </div>) : <p className={tw('my-1 text-xs text-[var(--text-secondary)]')}>暂无执行记录。</p>}
      </div></SettingsGroup>
    </>}
  </section>
}
