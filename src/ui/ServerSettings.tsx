import { useEffect, useState, type FormEvent } from 'react'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { TextField } from '@heroui/react/textfield'
import type { LingServer, LingServerEnvironment, LingServerInput, LingServerService } from '../runtime/servers.js'
import { CompactButton, CompactSelect, SettingsGroup, SettingsHeader } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { Menu, MenuItem } from './Menu.js'
import { tw } from './tailwind.js'

const environments: readonly { value: LingServerEnvironment; label: string }[] = [
  { value: 'development', label: '开发' },
  { value: 'staging', label: '预发' },
  { value: 'production', label: '生产' },
]

interface BrokerStatus { readonly trusted: boolean; readonly credential: 'none' | 'password' | 'key' }
interface NativeServerBroker {
  status(id: string): Promise<BrokerStatus>
  credentials(id: string): Promise<void>
  forget(id: string): Promise<void>
}
const nativeBroker = (globalThis as { __LING_SERVER_BROKER__?: NativeServerBroker }).__LING_SERVER_BROKER__

export function ServerSettings({ service, onBrowseFiles }: { readonly service?: LingServerService; readonly onBrowseFiles?: (id: string) => void }) {
  const [servers, setServers] = useState<readonly LingServer[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [connectionMode, setConnectionMode] = useState<'direct' | 'config'>('direct')
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('22')
  const [environment, setEnvironment] = useState<LingServerEnvironment>('development')
  const [deleteId, setDeleteId] = useState<string>()
  const [security, setSecurity] = useState<Record<string, BrokerStatus>>({})

  async function refreshSecurity(server: LingServer) {
    if (!nativeBroker || !server.user) return
    try { const status = await nativeBroker.status(server.id); setSecurity(current => ({ ...current, [server.id]: status })) }
    catch { setSecurity(current => ({ ...current, [server.id]: { trusted: false, credential: 'none' } })) }
  }

  useEffect(() => {
    let live = true
    if (!service) { setLoading(false); return }
    void service.list().then(result => {
      if (!live) return
      if (result.ok) { setServers(result.value); for (const server of result.value) void refreshSecurity(server) }
      else setError(result.message)
      setLoading(false)
    }).catch(() => { if (live) { setError('无法读取服务器清单。'); setLoading(false) } })
    return () => { live = false }
  }, [service])

  function resetForm() {
    setName(''); setAlias(''); setUser(''); setPort('22'); setEnvironment('development')
    setConnectionMode('direct'); setAdding(false); setEditingId(undefined)
  }

  function beginEdit(server: LingServer) {
    setAdding(false); setEditingId(server.id)
    setName(server.name); setAlias(server.alias); setUser(server.user ?? ''); setPort(String(server.port ?? 22))
    setEnvironment(server.environment)
    setConnectionMode(server.user || server.port || /^\d+\.\d+\.\d+\.\d+$/.test(server.alias) ? 'direct' : 'config')
    setError(undefined)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!service || pending) return
    const login = user.trim()
    const sshPort = Number(port)
    if (connectionMode === 'direct' && (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/.test(login) || !Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)) {
      setError('请填写登录用户和有效的 SSH 端口（1–65535）。')
      return
    }
    const input: LingServerInput = {
      name: name.trim(), alias: alias.trim(), environment,
      ...(connectionMode === 'direct' ? { user: login, port: sshPort } : {}),
    }
    setError(undefined)
    setPending(editingId ?? 'add')
    try {
      const result = editingId ? await service.update(editingId, input) : await service.add(input)
      if (!result.ok) { setError(result.message); return }
      setServers(current => editingId ? current.map(item => item.id === editingId ? result.value : item) : [...current, result.value])
      void refreshSecurity(result.value)
      const newlyAdded = !editingId
      resetForm()
      if (newlyAdded && result.value.user && nativeBroker) {
        setPending(undefined)
        try { await nativeBroker.credentials(result.value.id); await refreshSecurity(result.value) }
        catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开认证窗口。') }
      }
    } catch { setError('保存服务器失败。') }
    finally { setPending(undefined) }
  }

  async function remove(server: LingServer) {
    if (!service || pending) return
    setError(undefined)
    setPending(server.id)
    try {
      const result = await service.remove(server.id)
      if (!result.ok) { setError(result.message); return }
      setServers(current => current.filter(item => item.id !== server.id))
      setDeleteId(undefined)
      if (nativeBroker) {
        try { await nativeBroker.forget(server.id) }
        catch { setError('服务器已移除，但本地凭证清理失败。') }
      }
    } catch { setError('移除服务器失败。') }
    finally { setPending(undefined) }
  }

  async function manage(server: LingServer) {
    if (!server.user || !nativeBroker) { beginEdit(server); return }
    setError(undefined)
    try { await nativeBroker.credentials(server.id); await refreshSecurity(server) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开认证窗口。') }
  }

  const form = <form className={tw('grid gap-3 p-4')} onSubmit={event => { void save(event) }}>
    <div className={tw('flex items-center gap-1')} aria-label="连接方式">
      <CompactButton type="button" variant={connectionMode === 'direct' ? 'secondary' : 'tertiary'} onPress={() => setConnectionMode('direct')}>地址直连</CompactButton>
      <CompactButton type="button" variant={connectionMode === 'config' ? 'secondary' : 'tertiary'} onPress={() => setConnectionMode('config')}>SSH 别名</CompactButton>
    </div>
    <div className={tw('grid grid-cols-2 gap-3 max-[650px]:grid-cols-1')}>
      <TextField className={tw('gap-1')} isRequired name="server-name" onChange={setName} value={name} variant="secondary">
        <Label className={tw('text-xs text-[var(--text-secondary)]')}>名称</Label><Input placeholder="例如 生产服务器" />
      </TextField>
      <TextField className={tw('gap-1')} isRequired name="server-alias" onChange={setAlias} value={alias} variant="secondary">
        <Label className={tw('text-xs text-[var(--text-secondary)]')}>{connectionMode === 'direct' ? '服务器地址' : 'SSH 主机别名'}</Label><Input placeholder={connectionMode === 'direct' ? '例如 114.55.34.58' : '例如 ling-staging'} />
      </TextField>
    </div>
    {connectionMode === 'direct' ? <div className={tw('grid grid-cols-[minmax(0,1fr)_8rem] gap-3 max-[650px]:grid-cols-1')}>
      <TextField className={tw('gap-1')} isRequired name="server-user" onChange={setUser} value={user} variant="secondary">
        <Label className={tw('text-xs text-[var(--text-secondary)]')}>登录用户</Label><Input placeholder="例如 root 或 ubuntu" autoComplete="off" />
      </TextField>
      <TextField className={tw('gap-1')} isRequired name="server-port" onChange={setPort} value={port} variant="secondary">
        <Label className={tw('text-xs text-[var(--text-secondary)]')}>SSH 端口</Label><Input inputMode="numeric" placeholder="22" />
      </TextField>
    </div> : <p className={tw('m-0 text-xs text-[var(--text-secondary)]')}>使用 ~/.ssh/config 中已有的主机配置。</p>}
    <div className={tw('flex flex-wrap items-end justify-between gap-3')}>
      <div className={tw('grid gap-1')}><span className={tw('text-xs text-[var(--text-secondary)]')}>环境</span><CompactSelect label="环境" value={environment} options={environments} onChange={value => setEnvironment(value as LingServerEnvironment)} /></div>
      <div className={tw('flex items-center gap-2')}>
        {editingId ? <CompactButton type="button" variant="tertiary" onPress={resetForm}>取消</CompactButton> : null}
        <CompactButton type="submit" variant="primary" isDisabled={!service || Boolean(pending) || !name.trim() || !alias.trim() || (connectionMode === 'direct' && !user.trim())}>{pending === (editingId ?? 'add') ? '保存中…' : '保存'}</CompactButton>
      </div>
    </div>
  </form>

  return <section aria-label="服务器连接" className={tw('w-full min-w-0 max-w-3xl pb-8')}>
    <SettingsHeader title="服务器">
      <CompactButton variant="secondary" isDisabled={!service} onPress={() => { if (adding) resetForm(); else { resetForm(); setAdding(true) } }}>{adding ? '取消' : '添加服务器'}</CompactButton>
    </SettingsHeader>
    {adding ? <SettingsGroup title="添加服务器">{form}</SettingsGroup> : null}
    {error ? <p role="alert" className={tw('mb-4 text-xs text-[var(--danger)]')}>{error}</p> : null}
    <SettingsGroup>
      {loading ? <p className={tw('m-0 px-4 py-6 text-xs text-[var(--text-secondary)]')}>读取中…</p> : null}
      {!loading && !servers.length ? <p className={tw('m-0 px-4 py-6 text-xs text-[var(--text-secondary)]')}>{service ? '尚未添加服务器。' : '服务器服务暂时不可用。'}</p> : null}
      {servers.map((server, index) => <div key={server.id} className={tw(index > 0 && 'border-t border-[var(--panel-border)]')}>
        <div className={tw('flex min-h-14 items-center justify-between gap-3 px-4 py-2.5')}>
          <div className={tw('min-w-0')}>
            <div className={tw("truncate text-compact font-medium text-[var(--foreground)]")}>{server.name}</div>
            <div className={tw('mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)]')}>
              <span className={tw('truncate')}>{server.user ? `${server.user}@` : ''}{server.alias}{server.port && server.port !== 22 ? `:${server.port}` : ''}</span>
              <span aria-hidden="true">·</span><span>{environments.find(item => item.value === server.environment)?.label}</span>
              <span className={tw('inline-flex items-center gap-1.5')}><span aria-hidden="true" className={tw('size-1.5 rounded-full', server.user && nativeBroker && security[server.id]?.trusted && security[server.id]?.credential !== 'none' ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]')} />{server.user && nativeBroker ? security[server.id]?.trusted ? security[server.id]?.credential === 'none' ? '待设置凭证' : '已配置' : '待认证' : '系统 SSH'}</span>
            </div>
          </div>
          <div className={tw('flex shrink-0 items-center gap-1.5')}>
            <CompactButton variant="tertiary" isDisabled={Boolean(pending)} onPress={() => { void manage(server) }}>管理</CompactButton>
            <Menu triggerAriaLabel={`${server.name} 更多操作`} triggerClassName={tw("size-control-sm rounded-md hover:bg-[var(--surface-hover)]")} triggerLabel={<Icon name="more" size={15} />} listClassName={tw('min-w-32')}>
              {onBrowseFiles ? <MenuItem icon="folder" disabled={Boolean(pending)} onPress={() => { onBrowseFiles(server.id) }}>浏览远程文件</MenuItem> : null}
              <MenuItem icon="edit" disabled={Boolean(pending)} onPress={() => beginEdit(server)}>编辑信息</MenuItem>
              <MenuItem icon="trash" danger disabled={Boolean(pending)} onPress={() => setDeleteId(server.id)}>移除服务器</MenuItem>
            </Menu>
          </div>
        </div>
        {editingId === server.id ? <div className={tw('border-t border-[var(--panel-border)]')}>{form}</div> : null}
        {deleteId === server.id ? <div className={tw('flex flex-wrap items-center justify-between gap-2 border-t border-[var(--panel-border)] px-4 py-2 text-xs text-[var(--text-secondary)]')}><span>移除 {server.name}？</span><div className={tw('flex gap-1.5')}><CompactButton variant="tertiary" onPress={() => setDeleteId(undefined)}>取消</CompactButton><CompactButton variant="danger" isDisabled={Boolean(pending)} onPress={() => { void remove(server) }}>移除</CompactButton></div></div> : null}
      </div>)}
    </SettingsGroup>
  </section>
}
