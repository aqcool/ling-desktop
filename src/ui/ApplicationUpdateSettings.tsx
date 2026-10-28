import { useSyncExternalStore } from 'react'
import { ProgressBar } from '@heroui/react/progress-bar'
import type { LingUpdateBridge, LingUpdateChannel, LingUpdateState } from '../runtime/application-update.js'
import { Icon } from './Icon.js'
import { CompactButton, CompactSelect, SettingsGroup, SettingsHeader, SettingsRow } from './SettingsControls.js'
import { tw } from './tailwind.js'

type UpdateAction = 'check' | 'channel' | 'install'
interface UpdateSnapshot {
  readonly state?: LingUpdateState
  readonly loading: boolean
  readonly pending?: UpdateAction
  readonly error?: string
  readonly deferredVersions: readonly string[]
}

function createUpdateStore(bridge: LingUpdateBridge) {
  let snapshot: UpdateSnapshot = { loading: true, deferredVersions: [] }
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | undefined
  let generation = 0
  let revision = 0
  const publish = (patch: Partial<UpdateSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
  const run = async (action: UpdateAction, request: () => Promise<LingUpdateState>) => {
    if (snapshot.pending) return
    const previous = snapshot.state
    const started = ++revision
    publish({ pending: action, error: undefined })
    try {
      const state = await request()
      if (revision === started) publish({ state, loading: false })
    } catch {
      const phase = snapshot.state?.phase
      if (revision === started || (action === 'check' && phase === 'checking') || (action === 'install' && phase === 'installing')) {
        const error = action === 'channel' ? '更新渠道未保存，请重试。' : action === 'install' ? '无法启动更新，请重试。' : '检查更新失败，请重试。'
        publish({ state: previous ?? (snapshot.state ? { ...snapshot.state, phase: 'error', message: error } : undefined), loading: false, error })
      }
    } finally { publish({ pending: undefined }) }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        const current = ++generation
        unsubscribe = bridge.subscribe(state => { revision++; publish({ state, loading: false, error: undefined }) })
        const started = revision
        void bridge.get().then(state => {
          if (current === generation && started === revision) publish({ state, loading: false, error: undefined })
        }).catch(() => {
          if (current === generation && started === revision) publish({ loading: false, error: '无法读取更新状态，请重试。' })
        })
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) { generation++; unsubscribe?.(); unsubscribe = undefined }
      }
    },
    check: () => run('check', () => bridge.check()),
    setChannel: (channel: LingUpdateChannel) => run('channel', () => bridge.setChannel(channel)),
    install: () => run('install', () => bridge.install()),
    defer() {
      const version = snapshot.state?.version
      if (version && !snapshot.deferredVersions.includes(version)) publish({ deferredVersions: [...snapshot.deferredVersions, version] })
    },
  }
}

const stores = new WeakMap<LingUpdateBridge, ReturnType<typeof createUpdateStore>>()
const unavailableSnapshot: UpdateSnapshot = { loading: false, deferredVersions: [] }
const noSubscription = () => () => {}
const unavailable = () => unavailableSnapshot
function useApplicationUpdate() {
  const bridge = typeof window === 'undefined' ? undefined : window.__LING_UPDATE__
  let store = bridge ? stores.get(bridge) : undefined
  if (bridge && !store) { store = createUpdateStore(bridge); stores.set(bridge, store) }
  const snapshot = useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getSnapshot ?? unavailable, unavailable)
  return { ...snapshot, store }
}

const channelOptions = [{ value: 'stable', label: '稳定版' }, { value: 'preview', label: '预览版' }]
function phaseMessage(state: LingUpdateState | undefined, loading: boolean) {
  if (loading) return '正在读取更新状态…'
  if (!state) return '尚未读取更新状态。'
  if (state.phase === 'checking') return '正在检查更新…'
  if (state.phase === 'downloading') return `正在下载${state.version ? ` ${state.version}` : '更新'}…`
  if (state.phase === 'downloaded') return `${state.version ? `${state.version} ` : ''}已下载，重启后完成更新。`
  if (state.phase === 'installing') return '正在准备重启并更新…'
  if (state.phase === 'unavailable') return state.message || '当前应用暂不支持自动更新。'
  if (state.phase === 'error') return state.message || '更新未完成，请重试。'
  return state.message || (state.lastCheckedAt ? '当前已是最新版本。' : '可手动检查是否有新版本。')
}

export function ApplicationUpdateSettings({ version }: { readonly version?: string }) {
  const update = useApplicationUpdate()
  const { state, store } = update
  const ready = state?.phase === 'downloaded'
  const busy = update.loading || Boolean(update.pending) || state?.phase === 'checking' || state?.phase === 'downloading' || state?.phase === 'installing'
  const unsupported = !store || state?.phase === 'unavailable'
  const checking = update.pending === 'check' || state?.phase === 'checking'
  const deferred = Boolean(state?.version && update.deferredVersions.includes(state.version))
  const progress = state?.progress
  const percent = progress && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : undefined
  return <section aria-label="软件更新设置" className={tw('min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title="软件更新" description="检查新版本，下载完成后由你决定何时重启。" />
    <SettingsGroup>
      <SettingsRow title="当前版本"><span className={tw('break-all font-mono text-compact text-[var(--foreground)]')}>{state?.currentVersion || version || '未知'}</span></SettingsRow>
      <SettingsRow title="更新渠道" description={state?.channel === 'preview' ? '包含预览版本，可提前体验新功能。' : '接收正式发布的稳定版本。'}>
        <CompactSelect label="更新渠道" value={state?.channel ?? 'stable'} options={channelOptions} disabled={unsupported || busy} onChange={value => { if (value === 'stable' || value === 'preview') void store?.setChannel(value) }} />
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title="更新状态">
      <div className={tw('grid min-h-28 gap-4 p-4')}>
        <p role="status" aria-live="polite" className={tw('m-0 text-compact leading-6 text-[var(--text-secondary)]')}>{!store ? '软件更新仅在桌面应用中可用。' : update.pending === 'install' ? '正在准备更新…' : checking ? '正在检查更新…' : phaseMessage(state, update.loading)}</p>
        {state?.phase === 'downloading' ? <ProgressBar aria-label="更新下载进度" value={percent} isIndeterminate={percent === undefined} className={tw('w-full gap-2')}>
          <ProgressBar.Output className={tw('text-xs tabular-nums text-[var(--text-secondary)]')} />
          <ProgressBar.Track className={tw('h-1.5 rounded-full bg-[var(--surface-tertiary)]')}><ProgressBar.Fill className={tw('rounded-full bg-[var(--action)]')} /></ProgressBar.Track>
        </ProgressBar> : null}
        {update.error ? <p role="alert" className={tw('m-0 text-xs leading-5 text-[var(--danger)]')}>{update.error}</p> : null}
        <div className={tw('flex flex-wrap items-center gap-2')}>
          {ready ? <>
            <CompactButton variant="primary" isDisabled={busy} isPending={update.pending === 'install'} onPress={() => { void store?.install() }}>重启并更新</CompactButton>
            {!deferred ? <CompactButton variant="ghost" isDisabled={busy} onPress={() => store?.defer()}>稍后</CompactButton> : <span className={tw('text-xs text-[var(--text-secondary)]')}>可随时返回这里重启并更新。</span>}
          </> : <CompactButton variant="secondary" isDisabled={unsupported || busy} isPending={checking} onPress={() => { void store?.check() }}><Icon name="refresh" size={14} />{checking ? '正在检查…' : '检查更新'}</CompactButton>}
          {state?.lastCheckedAt ? <span className={tw('text-xs text-[var(--text-tertiary)]')}>上次检查：{new Date(state.lastCheckedAt).toLocaleString('zh-CN')}</span> : null}
        </div>
      </div>
    </SettingsGroup>
    {state?.releaseNotes ? <SettingsGroup title={`更新说明${state.version ? ` · ${state.version}` : ''}`}><div className={tw('whitespace-pre-wrap break-words p-4 text-compact leading-6 text-[var(--text-secondary)]')}>{state.releaseNotes}</div></SettingsGroup> : null}
  </section>
}

export function ApplicationUpdateReadyNotice({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  const update = useApplicationUpdate()
  const { state, store } = update
  if (state?.phase !== 'downloaded' || !state.version || update.deferredVersions.includes(state.version)) return null
  return <aside aria-label="软件更新已就绪" className={tw('fixed right-4 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-4 text-[var(--foreground)] shadow-[var(--overlay-shadow)]')}>
    <p role="status" aria-live="polite" className={tw('mb-1 mt-0 text-compact font-medium')}>新版本 {state.version} 已就绪</p>
    <p className={tw('mb-3 mt-0 text-xs leading-5 text-[var(--text-secondary)]')}>可在软件更新中查看说明并选择重启时间。</p>
    <div className={tw('flex flex-wrap gap-2')}><CompactButton variant="secondary" onPress={onOpenSettings}>查看更新</CompactButton><CompactButton variant="ghost" onPress={() => store?.defer()}>稍后</CompactButton></div>
  </aside>
}
