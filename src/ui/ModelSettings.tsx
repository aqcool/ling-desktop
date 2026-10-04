import { CompactSelect, CompactSwitch } from './SettingsControls.js'
import { CompactButton as Button } from './SettingsControls.js'
import { CompactInput as Input } from './SettingsControls.js'
import { Label } from '@heroui/react/label'
import { Modal } from '@heroui/react/modal'
import { TextArea } from '@heroui/react/textarea'
import { TextField } from '@heroui/react/textfield'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type {
  LingAuthorizationInteraction,
  LingAuthorizationNotice,
  LingAuthorizationPrompt,
  LingAuthorizationStatus,
  LingCommandResult,
  LingCustomProviderDraft,
  LingDiscoveredModel,
  LingModelProvider,
  LingModelSelection,
  LingModelSettings,
  LingProviderTestTarget,
  LingReadResult,
} from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { ProviderIcon } from './ProviderIcon.js'
import { tw } from './tailwind.js'

const customProtocols = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
] as const

type ProviderDialog =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly draft: LingCustomProviderDraft }

function testFeedback(
  models: readonly LingDiscoveredModel[],
  prefix: string,
): { ok: boolean; text: string } {
  if (models.length === 0) return { ok: true, text: `${prefix}：服务未返回模型列表。` }
  return { ok: true, text: `${prefix}：已发现 ${String(models.length)} 个模型。` }
}

function providerStatus(provider: LingModelProvider): string {
  if (provider.error) return '需要修复'
  if (provider.authorization?.configured) return '已登录'
  if (provider.authorization !== undefined) return '可登录'
  if (provider.credential === 'configured') return '已就绪'
  if (provider.credential === 'missing') return '需要 API Key'
  if (provider.active) return '可用'
  return provider.configured ? '等待加载' : '尚未配置'
}

interface PendingAuthorizationPrompt {
  readonly prompt: LingAuthorizationPrompt
  readonly resolve: (value: string) => void
  readonly reject: (reason: Error) => void
}

const authorizationUnavailable = async (): Promise<LingReadResult<LingAuthorizationStatus>> => ({
  ok: false,
  reason: 'runtime-unavailable',
  message: '当前运行时未提供账号登录。',
  retryable: false,
})

const signOutUnavailable = async (): Promise<LingReadResult<void>> => ({
  ok: false,
  reason: 'runtime-unavailable',
  message: '当前运行时未提供账号退出。',
  retryable: false,
})

function AuthorizationDialog({
  provider,
  onAuthorize,
  onClose,
}: {
  readonly provider: LingModelProvider
  readonly onAuthorize: (
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingAuthorizationStatus>>
  readonly onClose: () => void
}) {
  const controllerRef = useRef<AbortController | undefined>(undefined)
  const promptRef = useRef<PendingAuthorizationPrompt | undefined>(undefined)
  const [notices, setNotices] = useState<readonly LingAuthorizationNotice[]>([])
  const [prompt, setPrompt] = useState<PendingAuthorizationPrompt>()
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('正在连接登录服务…')
  const [pending, setPending] = useState(true)
  const [succeeded, setSucceeded] = useState(false)
  const [openingBrowser, setOpeningBrowser] = useState(false)
  const [browserFeedback, setBrowserFeedback] = useState<string>()
  const [attempt, setAttempt] = useState(0)

  const clearPrompt = (reason?: Error): void => {
    const current = promptRef.current
    promptRef.current = undefined
    setPrompt(undefined)
    setValue('')
    if (reason !== undefined) current?.reject(reason)
  }

  const close = (): void => {
    controllerRef.current?.abort()
    clearPrompt(new Error('登录已取消。'))
    onClose()
  }

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    setPending(true)
    setSucceeded(false)
    setNotices([])
    setBrowserFeedback(undefined)
    setMessage('正在连接登录服务…')
    const interaction: LingAuthorizationInteraction = {
      notify(notice) {
        setNotices(current => [...current, notice])
        setMessage(notice.message)
      },
      prompt(nextPrompt) {
        return new Promise<string>((resolve, reject) => {
          const pendingPrompt = { prompt: nextPrompt, resolve, reject }
          promptRef.current = pendingPrompt
          setPrompt(pendingPrompt)
          setValue('')
          setMessage(nextPrompt.message)
          const withdrawn = (): void => {
            if (promptRef.current !== pendingPrompt) return
            promptRef.current = undefined
            setPrompt(undefined)
            setValue('')
            reject(new Error('登录问题已撤回。'))
          }
          nextPrompt.signal?.addEventListener('abort', withdrawn, { once: true })
        })
      },
    }
    void onAuthorize(provider.providerId, interaction, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setPending(false)
      clearPrompt()
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      if (result.value === 'authorized') {
        clearPrompt()
        setSucceeded(true)
        setMessage('ChatGPT 账号已连接。')
      } else {
        setMessage('登录已取消。')
      }
    }, () => {
      if (!controller.signal.aborted) {
        setPending(false)
        clearPrompt()
        setMessage('无法完成 ChatGPT 登录。')
      }
    })
    return () => {
      controller.abort()
      promptRef.current?.reject(new Error('登录窗口已关闭。'))
      promptRef.current = undefined
    }
  }, [onAuthorize, provider.providerId, attempt])

  const answer = (answerValue: string): void => {
    const current = promptRef.current
    if (current === undefined) return
    promptRef.current = undefined
    setPrompt(undefined)
    setValue('')
    setMessage('正在验证…')
    current.resolve(answerValue)
  }

  const latestAction = [...notices].reverse().find(notice => notice.url !== undefined || notice.code !== undefined)
  const openLoginPage = async (): Promise<void> => {
    if (!latestAction?.url || openingBrowser) return
    setOpeningBrowser(true)
    setBrowserFeedback(undefined)
    try {
      const native = (globalThis as typeof globalThis & {
        __LING_EXTERNAL_LINKS__?: { open(url: string): Promise<void> }
      }).__LING_EXTERNAL_LINKS__
      if (native) await native.open(latestAction.url)
      else if (location.protocol === 'dsh-app:') throw new Error('Native browser bridge unavailable')
      else window.open(latestAction.url, '_blank', 'noopener,noreferrer')
    } catch {
      setBrowserFeedback('未能打开系统浏览器，请重试或复制登录链接到浏览器中打开。')
    } finally {
      setOpeningBrowser(false)
    }
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open) close() }} variant="blur">
      <Modal.Container size="md">
        <Modal.Dialog className={tw("authorization-dialog gap-4 rounded-2xl p-5 w-[min(30rem,calc(100vw-2rem))]")}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className={tw("text-base font-semibold")}>使用 ChatGPT 登录</Modal.Heading>
            <p className={tw("mt-1 text-sm text-[var(--text-secondary)]")}>登录后可直接使用 Codex 订阅模型。</p>
          </Modal.Header>
          <Modal.Body>
            <div className={tw("authorization-dialog__status flex min-h-[3.3rem] items-center gap-3")}>
              <span className={tw(
                "authorization-dialog__indicator grid size-[2.35rem] flex-none place-items-center rounded-full bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
                pending && "authorization-dialog__indicator--pending text-[var(--success)] ring-4 ring-[var(--focus)]",
                succeeded && "authorization-dialog__indicator--success bg-[color-mix(in_oklab,var(--success)_14%,var(--surface))] text-[var(--success)]",
              )}>
                <Icon name={succeeded ? 'check' : 'shield'} size={18} />
              </span>
              <div className={tw("grid gap-0.5")}>
                <strong className={tw("text-sm font-semibold")}>{succeeded ? '登录成功' : provider.authorization?.label ?? provider.displayName}</strong>
                <span className={tw("text-xs text-[var(--text-secondary)]")} role="status">{message}</span>
              </div>
            </div>

            {pending && latestAction?.code ? (
              <div className={tw("authorization-dialog__code grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-3 py-2.5") }>
                <span className={tw("text-xs text-[var(--text-secondary)]")}>验证码</span>
                <strong className={tw("font-mono text-base tracking-[0.08em]")}>{latestAction.code}</strong>
                <Button onPress={() => { void navigator.clipboard.writeText(latestAction.code ?? '') }} size="sm" variant="ghost">
                  <Icon name="copy" size={15} /> 复制
                </Button>
              </div>
            ) : null}
            {pending && latestAction?.url ? (
              <div className={tw("grid gap-2")}>
                <Button className={tw("authorization-dialog__open w-full justify-center")} isPending={openingBrowser} onPress={() => { void openLoginPage() }} variant="secondary">
                  <Icon name="external" size={16} /> 打开登录页面
                </Button>
                <Button size="sm" variant="ghost" onPress={() => {
                  void navigator.clipboard.writeText(latestAction.url!).then(
                    () => { setBrowserFeedback('登录链接已复制。') },
                    () => { setBrowserFeedback('未能复制登录链接，请重试。') },
                  )
                }}><Icon name="copy" size={14} />复制登录链接</Button>
                {browserFeedback ? <p className={tw("m-0 text-xs text-[var(--text-secondary)]")} role="status">{browserFeedback}</p> : null}
              </div>
            ) : null}

            {prompt?.prompt.kind === 'select' ? (
              <div className={tw("authorization-dialog__choices grid gap-2")}>
                {prompt.prompt.options?.map(option => (
                  <Button className={tw("min-h-12 w-full justify-between")} key={option.id} onPress={() => { answer(option.id) }} variant="secondary">
                    <span className={tw("grid text-left")}>
                      <strong className={tw("text-compact")}>{option.label}</strong>
                      {option.description ? <small className={tw("mt-0.5 text-caption text-[var(--text-tertiary)]")}>{option.description}</small> : null}
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </Button>
                ))}
              </div>
            ) : prompt ? (
              <form className={tw("authorization-dialog__answer grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 max-[560px]:grid-cols-1")} onSubmit={(event) => { event.preventDefault(); if (value.trim()) answer(value.trim()) }}>
                <TextField
                  autoFocus
                  name="authorization-answer"
                  onChange={setValue}
                  type={prompt.prompt.kind === 'secret' ? 'password' : 'text'}
                  value={value}
                  variant="secondary"
                >
                  <Label>授权码或回调地址</Label>
                  <Input placeholder={prompt.prompt.placeholder ?? '粘贴登录结果'} />
                </TextField>
                <Button className={tw("min-h-[2.35rem]")} isDisabled={!value.trim()} type="submit">继续</Button>
              </form>
            ) : null}
          </Modal.Body>
          <Modal.Footer className={tw("gap-2")}>
            <Button onPress={close} variant={succeeded ? 'primary' : 'ghost'}>{succeeded ? '完成' : '取消'}</Button>
            {!pending && !succeeded ? <Button onPress={() => { setAttempt(current => current + 1) }}>重新登录</Button> : null}
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function AuthorizationEditor({
  provider,
  writable,
  onAuthorize,
  onSignOut,
}: {
  readonly provider: LingModelProvider
  readonly writable: boolean
  readonly onAuthorize: (
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingAuthorizationStatus>>
  readonly onSignOut: (providerId: string) => Promise<LingReadResult<void>>
}) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const authorization = provider.authorization
  if (authorization === undefined) return null

  const signOut = async (): Promise<void> => {
    setSigningOut(true)
    setFeedback(undefined)
    const result = await onSignOut(provider.providerId)
    setSigningOut(false)
    if (!result.ok) setFeedback(result.message)
  }

  return (
    <section className={tw("model-provider__authorization grid gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)] p-3")}>
      <div className={tw("grid gap-0.5")}>
        <strong className={tw("text-compact font-medium")}>ChatGPT 账号</strong>
        <span className={tw("text-xs leading-5 text-[var(--text-secondary)]")}>{authorization.configured ? '已连接，可使用 Codex 订阅模型' : '使用 ChatGPT Plus、Pro 或团队账号'}</span>
      </div>
      <div className={tw("model-provider__authorization-actions flex flex-wrap gap-2")}>
        <Button className={tw("h-control min-h-control text-xs")} isDisabled={!writable || authorization.inFlight || signingOut} onPress={() => { setOpen(true) }} size="sm">
          {authorization.configured ? '重新登录' : '使用 ChatGPT 登录'}
        </Button>
        {authorization.configured ? (
          <Button className={tw("h-control min-h-control text-xs")} isDisabled={!authorization.writable || signingOut} isPending={signingOut} onPress={() => { void signOut() }} size="sm" variant="ghost">退出登录</Button>
        ) : null}
      </div>
      {feedback ? <p className={tw("model-settings__error m-0 text-xs text-[var(--danger)]")} role="status">{feedback}</p> : null}
      {open ? <AuthorizationDialog onAuthorize={onAuthorize} onClose={() => { setOpen(false) }} provider={provider} /> : null}
    </section>
  )
}

function CredentialEditor({
  provider,
  writable,
  onSave,
}: {
  readonly provider: LingModelProvider
  readonly writable: boolean
  readonly onSave: (providerId: string, apiKey: string) => Promise<LingCommandResult>
}) {
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>()

  const save = async (): Promise<void> => {
    if (!value.trim() || pending) return
    setPending(true)
    setFeedback(undefined)
    try {
      const result = await onSave(provider.providerId, value)
      if (result.accepted) {
        setValue('')
        setFeedback({ ok: true, text: 'API Key 已保存。' })
      } else {
        setFeedback({ ok: false, text: result.message })
      }
    } catch {
      setFeedback({ ok: false, text: '无法保存 API Key。' })
    } finally {
      setPending(false)
    }
  }

  if (provider.authorization !== undefined || !provider.configurable || !provider.canStoreApiKey) return null

  return (
    <div className={tw("model-provider__credential mt-4 grid gap-3")}>
      <TextField
        className={tw("gap-1")}
        isDisabled={!writable || pending}
        name={`${provider.providerId}-api-key`}
        onChange={setValue}
        type="password"
        value={value}
        variant="secondary"
      >
        <Label className={tw("text-xs font-medium text-[var(--text-secondary)]")}>API Key</Label>
        <Input placeholder="粘贴 API Key" />
      </TextField>
      <div className={tw("model-provider__credential-actions flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]")}>
        <span>{provider.credential === 'configured' ? '已配置' : '未配置'}</span>
        <Button className={tw("min-h-[1.9rem] text-xs")} isDisabled={!writable || !value.trim()} isPending={pending} onPress={() => { void save() }} size="sm" variant="secondary">
          保存
        </Button>
      </div>
      {feedback ? (
        <p className={tw("m-0 text-xs", feedback.ok ? "model-provider__saved text-[var(--success)]" : "model-settings__error text-[var(--danger)]")} role="status">{feedback.text}</p>
      ) : null}
    </div>
  )
}

function providerConnected(provider: LingModelProvider): boolean {
  if (provider.authorization !== undefined) return provider.authorization.configured
  return ((provider.configured || provider.active) && provider.credential === 'configured')
    || (provider.active && provider.credential === 'not-required')
}

const commonProviderIds = ['openai-codex', 'anthropic', 'openai', 'google', 'deepseek', 'openrouter']
const providerNames: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', deepseek: 'DeepSeek',
  openrouter: 'OpenRouter', 'github-copilot': 'GitHub Copilot',
  'amazon-bedrock': 'Amazon Bedrock', 'azure-openai-responses': 'Azure OpenAI',
  'google-vertex': 'Google Vertex AI', minimax: 'MiniMax', mistral: 'Mistral',
  groq: 'Groq', xai: 'xAI', 'kimi-coding': 'Kimi Coding',
}

function providerName(provider: LingModelProvider): string {
  return provider.displayName === provider.providerId
    ? providerNames[provider.providerId] ?? provider.displayName
    : provider.displayName
}

function ProviderMark({ provider }: { readonly provider: LingModelProvider }) {
  return <span aria-hidden="true" className={tw("grid size-control-lg shrink-0 place-items-center rounded-lg border border-[var(--panel-border)]/60 bg-[var(--surface)] text-[var(--foreground)]")}><ProviderIcon providerId={provider.providerId} /></span>
}

function ProviderCard({ provider, models, defaultSelection, writable, selecting, onSelectDefault, onModelEnabledChange, onConnect, onRequestDelete }: {
  readonly provider: LingModelProvider
  readonly models: LingModelProvider['models']
  readonly defaultSelection: LingModelSelection
  readonly writable: boolean
  readonly selecting: boolean
  readonly onSelectDefault: (selection: LingModelSelection) => void
  readonly onModelEnabledChange: (selection: LingModelSelection, enabled: boolean) => void
  readonly onConnect: () => void
  readonly onRequestDelete: (provider: LingModelProvider) => void
}) {
  const connected = providerConnected(provider)
  return <section className={tw("min-w-0")} aria-label={`${provider.displayName}模型`}>
    <div className={tw("mb-3 flex min-h-9 items-center gap-2.5")}>
      <ProviderMark provider={provider} />
      <h2 className={tw("m-0 min-w-0 truncate text-sm font-medium")}>{providerName(provider)}</h2>
      <span className={tw("text-xs text-[var(--text-tertiary)]")}>{models.length}</span>
      <div className={tw("ml-auto flex shrink-0 items-center gap-1")}>
        <Button aria-label={`管理${provider.displayName}连接`} className={tw("h-control-sm min-h-control-sm px-2 text-xs text-[var(--text-secondary)]")} onPress={onConnect} size="sm" variant="ghost">管理连接</Button>
        {provider.canDelete ? <Button aria-label={`删除${providerName(provider)}`} className={tw("h-control-sm min-h-control-sm px-2 text-xs text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))]")} isDisabled={!writable} onPress={() => { onRequestDelete(provider) }} size="sm" variant="ghost">删除</Button> : null}
      </div>
    </div>
    <div className={tw("overflow-hidden rounded-xl border border-[var(--panel-border)]/70 bg-[var(--surface)]")}>
      {models.map(model => {
        const selected = defaultSelection.provider === provider.providerId && defaultSelection.model === model.id
        return <div className={tw("model-provider__row flex min-h-[60px] items-center justify-between gap-3 border-b border-[var(--panel-border)]/50 px-4 py-3 transition-colors hover:bg-[var(--surface-secondary)] last:border-0")} key={model.id}>
          <div className={tw("min-w-0", model.enabled === false && "text-[var(--text-tertiary)]")}>
            <span className={tw("block truncate text-compact font-medium")} title={model.id}>{model.name}</span>
            {model.name !== model.id ? <span className={tw("mt-0.5 block truncate text-xs text-[var(--text-tertiary)]")} title={model.id}>{model.id}</span> : null}
          </div>
          <div className={tw("flex shrink-0 items-center gap-2")}>
            {selected ? <span aria-label={`${model.name}是默认模型`} className={tw("model-provider__default--selected inline-flex h-control-xs shrink-0 items-center gap-1 rounded-md bg-[var(--plan-mode-background)] px-2 text-caption font-medium text-[var(--focus)] dark:text-[var(--plan-mode-foreground)]")}><Icon name="check" size={14} />默认</span> : model.enabled !== false ? <Button aria-label={connected ? `将${model.name}设为默认模型` : `连接${provider.displayName}以使用${model.name}`} className={tw("h-control-sm min-h-control-sm shrink-0 px-2 text-xs")} isDisabled={!writable || selecting} onPress={() => { if (connected) onSelectDefault({ provider: provider.providerId, model: model.id }); else onConnect() }} size="sm" variant="ghost">{connected ? '设为默认' : '连接'}</Button> : null}
            <CompactSwitch label={`启用${model.name}`} selected={model.enabled !== false} disabled={selecting} onChange={enabled => { onModelEnabledChange({ provider: provider.providerId, model: model.id }, enabled) }} />
          </div>
        </div>
      })}
    </div>
  </section>
}

function ProviderConnectionDialog({ provider, writable, onClose, onEdit, onSaveApiKey, onAuthorize, onSignOut, onTest }: {
  readonly provider: LingModelProvider
  readonly writable: boolean
  readonly onClose: () => void
  readonly onEdit: (draft: LingCustomProviderDraft) => void
  readonly onSaveApiKey: (providerId: string, apiKey: string) => Promise<LingCommandResult>
  readonly onAuthorize: (providerId: string, interaction: LingAuthorizationInteraction, signal: AbortSignal) => Promise<LingReadResult<LingAuthorizationStatus>>
  readonly onSignOut: (providerId: string) => Promise<LingReadResult<void>>
  readonly onTest: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>>
}) {
  return <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open) onClose() }}>
    <Modal.Container size="sm">
      <Modal.Dialog className={tw("gap-0 rounded-2xl p-5")}>
        <Modal.CloseTrigger />
        <Modal.Header className={tw("flex-row items-center gap-3 pr-9")}><ProviderMark provider={provider} /><div className={tw("min-w-0")}><Modal.Heading className={tw("text-base font-semibold")}>{providerName(provider)}</Modal.Heading><span className={tw("mt-1 block text-xs text-[var(--text-tertiary)]")}>{providerStatus(provider)}</span></div></Modal.Header>
        <Modal.Body className={tw("flex-none")}>
          {provider.error ? <p className={tw("m-0 text-xs text-[var(--danger)]")} role="status">{provider.error}</p> : null}
          {!provider.configurable && !provider.authorization ? <p className={tw("m-0 text-sm text-[var(--text-secondary)]")}>此连接由运行环境管理。</p> : null}
          <AuthorizationEditor provider={provider} writable={writable} onAuthorize={onAuthorize} onSignOut={onSignOut} />
          <CredentialEditor provider={provider} writable={writable} onSave={onSaveApiKey} />
          <ProviderActions provider={provider} writable={writable} onEdit={onEdit} onTest={onTest} />
        </Modal.Body>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}

function ProviderDeleteDialog({ provider, writable, onClose, onDelete }: {
  readonly provider: LingModelProvider
  readonly writable: boolean
  readonly onClose: () => void
  readonly onDelete: (providerId: string) => Promise<LingCommandResult>
}) {
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState<string>()

  const remove = async (): Promise<void> => {
    if (deleting) return
    setDeleting(true)
    setMessage(undefined)
    try {
      const result = await onDelete(provider.providerId)
      if (!result.accepted) setMessage(result.message)
    } catch {
      setMessage('无法删除该提供商。')
    } finally {
      setDeleting(false)
    }
  }

  return <Modal.Backdrop isDismissable={!deleting} isOpen onOpenChange={(open: boolean) => { if (!open && !deleting) onClose() }} variant="blur">
    <Modal.Container size="sm">
      <Modal.Dialog className={tw("gap-0 rounded-2xl p-5")}>
        <Modal.CloseTrigger />
        <Modal.Header className={tw("pr-9")}><Modal.Heading className={tw("text-base font-semibold")}>删除 {providerName(provider)}？</Modal.Heading></Modal.Header>
        <Modal.Body className={tw("flex-none")}>
          <p className={tw("m-0 text-sm leading-6 text-[var(--text-secondary)]")}>将移除已保存的连接和模型配置。</p>
          {message ? <p className={tw("mb-0 mt-3 text-xs text-[var(--danger)]")} role="status">{message}</p> : null}
        </Modal.Body>
        <Modal.Footer className={tw("mt-4 flex justify-end gap-2 border-t border-[var(--panel-border)] pt-3")}>
          <Button isDisabled={deleting} onPress={onClose} size="sm" variant="ghost">取消</Button>
          <Button isDisabled={!writable} isPending={deleting} onPress={() => { void remove() }} size="sm" variant="danger">删除</Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}

function CustomProviderDialog({
  dialog,
  onClose,
  onSave,
  onTest,
}: {
  readonly dialog: ProviderDialog
  readonly onClose: () => void
  readonly onSave: (provider: LingCustomProviderDraft) => Promise<LingCommandResult>
  readonly onTest: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>>
}) {
  const draft = dialog.mode === 'edit' ? dialog.draft : undefined
  const editing = draft !== undefined
  const initialModels = draft?.models ?? []
  const [providerId, setProviderId] = useState(draft?.providerId ?? '')
  const [displayName, setDisplayName] = useState(draft?.displayName ?? '')
  const [baseUrl, setBaseUrl] = useState(draft?.baseUrl ?? '')
  const [protocol, setProtocol] = useState<string>(draft?.protocol ?? customProtocols[0])
  const [modelText, setModelText] = useState(draft?.models.map(model => model.id).join('\n') ?? '')
  const [apiKey, setApiKey] = useState('')
  const [pending, setPending] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<string>()
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string }>()
  const protocols = useMemo<readonly string[]>(() => (customProtocols as readonly string[]).includes(protocol)
    ? customProtocols
    : [...customProtocols, protocol], [protocol])

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (pending) return
    const models = modelText.split(/[\n,]/u).map(id => id.trim()).filter(Boolean).map((id) => {
      const known = initialModels.find(model => model.id === id)
      return known?.name === undefined ? { id } : { id, name: known.name }
    })
    setPending(true)
    setMessage(undefined)
    try {
      const result = await onSave({
        providerId,
        ...(displayName.trim() ? { displayName } : {}),
        baseUrl,
        protocol,
        models,
        ...(apiKey.trim() ? { apiKey } : {}),
      })
      if (!result.accepted) {
        setMessage(result.message)
        return
      }
      onClose()
    } catch {
      setMessage(editing ? '无法保存提供商。' : '无法添加提供商。')
    } finally {
      setPending(false)
    }
  }

  const test = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    setMessage(undefined)
    setTestResult(undefined)
    try {
      const result = await onTest(editing
        ? { providerId }
        : { baseUrl, protocol, ...(apiKey.trim() ? { apiKey } : {}) })
      setTestResult(result.ok
        ? testFeedback(result.value, editing ? '已按保存的配置连接成功' : '连接成功')
        : { ok: false, text: result.message })
    } catch {
      setTestResult({ ok: false, text: '无法完成连接测试。' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open) onClose() }} variant="blur">
      <Modal.Container size="lg">
        <Modal.Dialog className={tw("custom-provider-dialog gap-4 rounded-2xl p-5 w-[min(100%,38rem)]")}>
          <Modal.CloseTrigger />
          <Modal.Header className={tw("block pb-2")}>
            <Modal.Heading className={tw("text-base font-semibold")}>{editing ? '编辑提供商' : '连接自定义提供商'}</Modal.Heading>
            <p className={tw("mt-1.5 text-xs text-[var(--text-secondary)]")}>{editing ? '更新连接配置。' : 'OpenAI 或 Anthropic 兼容服务'}</p>
          </Modal.Header>
          <form className={tw("flex min-h-0 flex-1 flex-col")} onSubmit={event => { void submit(event) }}>
            <Modal.Body className={tw("min-h-0 overflow-y-auto pt-2")}>
              <div className={tw("custom-provider-dialog__fields grid grid-cols-2 gap-3 max-[700px]:grid-cols-1")}>
                <TextField className={tw("gap-1")} isDisabled={editing || pending} isRequired name="provider-id" onChange={setProviderId} value={providerId} variant="secondary">
                  <Label className={tw("text-xs font-medium text-[var(--text-secondary)]")}>提供商标识</Label>
                  <Input placeholder="例如 my-provider" />
                </TextField>
                <TextField className={tw("gap-1")} isDisabled={pending} name="provider-name" onChange={setDisplayName} value={displayName} variant="secondary">
                  <Label className={tw("text-xs font-medium text-[var(--text-secondary)]")}>显示名称</Label>
                  <Input placeholder="自定义模型服务" />
                </TextField>
                <TextField className={tw("col-span-2 gap-1 max-[700px]:col-auto")} isDisabled={pending} isRequired name="provider-url" onChange={setBaseUrl} type="url" value={baseUrl} variant="secondary">
                  <Label className={tw("text-xs font-medium text-[var(--text-secondary)]")}>服务地址</Label>
                  <Input placeholder="https://api.example.com/v1" />
                </TextField>
                <div className={tw('grid gap-1')}><Label className={tw('text-xs font-medium text-[var(--text-secondary)]')}>协议</Label><CompactSelect className={tw('w-full')} label="协议" disabled={pending} onChange={setProtocol} value={protocol} options={protocols.map(value => ({ value, label: value }))} /></div>
                <TextField className={tw("col-span-2 gap-1 max-[700px]:col-auto")} isDisabled={pending} isRequired name="provider-models" onChange={setModelText} value={modelText} variant="secondary">
                  <Label className={tw("text-xs font-medium text-[var(--text-secondary)]")}>模型 ID</Label>
                  <TextArea placeholder="每行一个模型 ID" rows={3} />
                </TextField>
                <TextField className={tw("col-span-2 gap-1 max-[700px]:col-auto")} isDisabled={pending} name="provider-api-key" onChange={setApiKey} type="password" value={apiKey} variant="secondary">
                  <Label className={tw("text-xs font-medium text-[var(--text-secondary)]")}>API Key</Label>
                  <Input placeholder={editing ? '留空则沿用已保存的 Key' : '可稍后设置'} />
                </TextField>
              </div>
              {message ? <p className={tw("model-settings__banner model-settings__error mt-3 rounded-lg border border-[color-mix(in_oklab,var(--danger)_30%,var(--panel-border))] bg-[color-mix(in_oklab,var(--danger)_6%,var(--surface))] px-3 py-2.5 text-xs text-[var(--danger)]")} role="status">{message}</p> : null}
              {testResult ? (
                <p className={tw("m-0 text-xs", testResult.ok ? "model-provider__saved text-[var(--success)]" : "model-settings__error text-[var(--danger)]")} role="status">{testResult.text}</p>
              ) : null}
            </Modal.Body>
            <Modal.Footer className={tw("flex justify-end gap-2")}>
              <Button isDisabled={pending || testing} onPress={() => { void test() }} variant="secondary">测试连接</Button>
              <Button isDisabled={pending} onPress={onClose} slot="close" variant="ghost">取消</Button>
              <Button isPending={pending} type="submit">{editing ? '保存修改' : '连接'}</Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function ProviderActions({
  provider,
  writable,
  onEdit,
  onTest,
}: {
  readonly provider: LingModelProvider
  readonly writable: boolean
  readonly onEdit: (draft: LingCustomProviderDraft) => void
  readonly onTest: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>>
}) {
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>()
  const draft = provider.draft

  if (provider.canEdit !== true && provider.canTest !== true) return null

  const runTest = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    setFeedback(undefined)
    try {
      const result = await onTest({ providerId: provider.providerId })
      setFeedback(result.ok
        ? testFeedback(result.value, '连接成功')
        : { ok: false, text: result.message })
    } catch {
      setFeedback({ ok: false, text: '无法完成连接测试。' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={tw("model-provider__actions mt-4 grid gap-3 border-t border-[var(--panel-border)] pt-3")}>
      <div className={tw("model-provider__actions-row flex gap-2 flex-wrap")}>
        {provider.canEdit && draft !== undefined ? (
          <Button className={tw("min-h-[1.9rem] text-xs")} isDisabled={!writable || testing} onPress={() => { onEdit(draft) }} size="sm" variant="secondary">编辑</Button>
        ) : null}
        {provider.canTest ? (
          <Button className={tw("min-h-[1.9rem] text-xs")} isDisabled={testing} isPending={testing} onPress={() => { void runTest() }} size="sm" variant="secondary">测试连接</Button>
        ) : null}
      </div>
      {feedback ? <p className={tw("m-0 text-xs", feedback.ok ? "model-provider__saved text-[var(--success)]" : "model-settings__error text-[var(--danger)]")} role="status">{feedback.text}</p> : null}
    </div>
  )
}

export function ModelSettings({
  loading,
  message,
  onCreateCustomProvider,
  onDeleteProvider,
  onRefresh,
  onAuthorizeProvider,
  onSaveApiKey,
  onSelectDefault,
  onModelEnabledChange,
  onSignOutProvider,
  onTestProvider,
  onUpdateCustomProvider,
  settings,
}: {
  readonly loading: boolean
  readonly message?: string
  readonly onCreateCustomProvider: (provider: LingCustomProviderDraft) => Promise<LingCommandResult>
  readonly onDeleteProvider: (providerId: string) => Promise<LingCommandResult>
  readonly onRefresh: () => void
  readonly onAuthorizeProvider?: (
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingAuthorizationStatus>>
  readonly onSaveApiKey: (providerId: string, apiKey: string) => Promise<LingCommandResult>
  readonly onSelectDefault: (selection: LingModelSelection) => Promise<LingCommandResult>
  readonly onModelEnabledChange: (selection: LingModelSelection, enabled: boolean) => Promise<string | undefined>
  readonly onSignOutProvider?: (providerId: string) => Promise<LingReadResult<void>>
  readonly onTestProvider: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>>
  readonly onUpdateCustomProvider: (provider: LingCustomProviderDraft) => Promise<LingCommandResult>
  readonly settings?: LingModelSettings
}) {
  const [providerDialog, setProviderDialog] = useState<ProviderDialog>()
  const [selecting, setSelecting] = useState(false)
  const [updatingVisibility, setUpdatingVisibility] = useState(false)
  const [selectionMessage, setSelectionMessage] = useState<string>()
  const [view, setView] = useState<'models' | 'providers'>('models')
  const [search, setSearch] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<LingModelProvider>()
  const [showAllProviders, setShowAllProviders] = useState(false)
  const allProviders = settings?.providers ?? []
  const hasOfficialDeepSeek = allProviders.some(provider => provider.providerId === 'deepseek-official')
  // The dormant Pi catalog entry shares the official route's API key name.
  // Without a profile or models it is only a duplicate suggestion, not a saved connection.
  const providers = allProviders.filter(provider => !(
    hasOfficialDeepSeek
    && provider.providerId === 'deepseek'
    && !provider.configured
    && !provider.active
    && provider.models.length === 0
  ))
  const query = search.trim().toLocaleLowerCase()
  const visibleProviders = providers.map(provider => ({
    provider,
    models: provider.models.filter(model => `${providerName(provider)} ${provider.providerId} ${model.name} ${model.id}`.toLocaleLowerCase().includes(query)),
  })).filter(group => group.models.length > 0)
  const filteredProviders = providers.filter(provider => `${providerName(provider)} ${provider.providerId}`.toLocaleLowerCase().includes(query))
  const availableProviders = filteredProviders.filter(provider => !providerConnected(provider))
  const commonProviders = availableProviders.filter(provider => commonProviderIds.includes(provider.providerId))
    .sort((a, b) => commonProviderIds.indexOf(a.providerId) - commonProviderIds.indexOf(b.providerId))
  const suggestedProviders = commonProviders.length ? commonProviders : availableProviders.slice(0, 6)
  const connectionProvider = providers.find(provider => provider.providerId === connectionId)
  const selectionKnown = settings === undefined || providers.some(provider => (
    provider.providerId === settings.defaultSelection.provider
    && provider.models.some(model => model.id === settings.defaultSelection.model)
  ))

  const changeSelection = async (next: LingModelSelection): Promise<void> => {
    if (selecting) return
    setSelecting(true)
    setSelectionMessage(undefined)
    try {
      const result = await onSelectDefault(next)
      if (!result.accepted) setSelectionMessage(result.message)
    } catch {
      setSelectionMessage('无法更新默认模型。')
    } finally {
      setSelecting(false)
    }
  }

  const changeVisibility = async (next: LingModelSelection, enabled: boolean): Promise<void> => {
    if (selecting || updatingVisibility) return
    setUpdatingVisibility(true)
    setSelectionMessage(undefined)
    try {
      const error = await onModelEnabledChange(next, enabled)
      if (error) setSelectionMessage(error)
    } catch {
      setSelectionMessage('无法更新模型启用状态。')
    } finally {
      setUpdatingVisibility(false)
    }
  }

  return (
    <section className={tw("model-settings w-full min-w-0 max-w-3xl pb-8")} aria-label="模型设置">
      <div className={tw("mb-5 flex items-center justify-between gap-3")}>
        <h1 className={tw("m-0 text-xl font-semibold text-[var(--foreground)]")}>模型</h1>
        <Button isIconOnly aria-label="刷新模型设置" className={tw("size-8 min-w-8")} isPending={loading} onPress={onRefresh} size="sm" variant="ghost"><Icon name="refresh" size={16} /></Button>
      </div>
      <nav aria-label="模型设置分类" className={tw("mb-5 flex w-fit gap-0.5 rounded-lg bg-[var(--surface-secondary)] p-1")}>
        {(['models', 'providers'] as const).map(tab => <Button aria-pressed={view === tab} className={tw("h-control-sm min-h-control-sm rounded-md px-4 text-xs", view === tab ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm" : "bg-transparent text-[var(--text-secondary)] shadow-none")} key={tab} onPress={() => { setView(tab); setSearch('') }} size="sm" variant="ghost">{tab === 'models' ? '模型' : '提供商'}</Button>)}
      </nav>
      <TextField aria-label={view === 'models' ? '搜索模型' : '搜索提供商'} className={tw("mb-6")} onChange={setSearch} value={search}>
        <div className={tw("flex h-control-lg items-center gap-2 rounded-lg border border-[var(--panel-border)]/70 bg-[var(--surface)] px-3 transition-colors focus-within:border-[var(--focus)] focus-within:ring-2 focus-within:ring-[var(--focus)]/10")}>
          <Icon className={tw("shrink-0 text-[var(--text-tertiary)]")} name="search" size={15} />
          <Input className={tw("h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-compact shadow-none outline-none")} placeholder={view === 'models' ? '搜索模型或提供商' : '搜索提供商'} />
          {search ? <Button isIconOnly aria-label="清空搜索" className={tw("size-6 min-h-6 min-w-6")} onPress={() => { setSearch('') }} size="sm" variant="ghost"><Icon name="close" size={12} /></Button> : null}
        </div>
      </TextField>
      {[message, selectionMessage].filter(Boolean).map((text, index) => <p className={tw("model-settings__error mb-4 text-xs text-[var(--danger)]")} key={index} role="status">{text}</p>)}
      {settings && !settings.writable ? <p className={tw("mb-4 text-xs text-[var(--text-tertiary)]")}>当前模型配置为只读。</p> : null}
      {settings && !selectionKnown ? <p className={tw("model-settings__warning mb-4 text-xs text-[var(--warning)]")} role="status">当前默认模型已不可用，请选择新的默认模型。</p> : null}
      {loading && !settings ? <p className={tw("py-10 text-center text-sm text-[var(--text-tertiary)]")} role="status">正在读取模型设置…</p> : null}
      {!settings && !loading ? <p className={tw("py-10 text-center text-sm text-[var(--text-tertiary)]")}>暂时无法读取模型配置</p> : null}
      {settings && view === 'models' ? <div className={tw("grid gap-7")}>
        {visibleProviders.map(({ provider, models }) => <ProviderCard key={provider.providerId} provider={provider} models={models} defaultSelection={settings.defaultSelection} selecting={selecting || updatingVisibility} writable={settings.writable} onConnect={() => { setConnectionId(provider.providerId) }} onRequestDelete={setDeleteTarget} onSelectDefault={selection => { void changeSelection(selection) }} onModelEnabledChange={(selection, enabled) => { void changeVisibility(selection, enabled) }} />)}
        {!visibleProviders.length ? <div className={tw("flex flex-col items-center gap-3 py-10 text-sm text-[var(--text-tertiary)]")}><span>{query ? '没有找到匹配的模型' : '还没有可用模型'}</span>{!query ? <Button onPress={() => { setView('providers') }} size="sm" variant="secondary">连接提供商</Button> : null}</div> : null}
      </div> : null}
      {settings && view === 'providers' ? <div className={tw("grid gap-7")}>
        {[{ connected: true, title: '已连接' }, { connected: false, title: query || showAllProviders ? '可连接' : '常用提供商' }].map(group => {
          const entries = group.connected ? filteredProviders.filter(providerConnected) : query || showAllProviders ? availableProviders : suggestedProviders
          if (!entries.length) return null
          return <section key={group.title}>
            <h2 className={tw("mb-3 mt-0 flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]")}>{group.connected ? <span aria-hidden="true" className={tw("size-1.5 rounded-full bg-[var(--success)]")} /> : null}{group.title}<span className={tw("font-normal tabular-nums text-[var(--text-tertiary)]")}>{entries.length}</span></h2>
            <div className={tw("overflow-hidden rounded-xl border border-[var(--panel-border)]/70 bg-[var(--surface)]")}>
              {entries.map(provider => <div className={tw("flex min-h-[64px] items-center justify-between gap-3 border-b border-[var(--panel-border)]/50 px-4 py-3 transition-colors hover:bg-[var(--surface-secondary)] last:border-0")} key={provider.providerId}>
                <div className={tw("flex min-w-0 items-center gap-3")}><ProviderMark provider={provider} /><div className={tw("min-w-0")}><span className={tw("block truncate text-compact font-medium")}>{providerName(provider)}</span><span className={tw("mt-0.5 block truncate text-xs text-[var(--text-tertiary)]")} title={provider.providerId}>{providers.some(other => other.providerId !== provider.providerId && providerName(other).toLocaleLowerCase() === providerName(provider).toLocaleLowerCase()) ? `${provider.providerId} · ` : ''}{provider.error ? '连接异常' : group.connected ? `${provider.models.length ? `${provider.models.length} 个模型` : '暂无模型'} · ${provider.authorization?.configured ? '账号登录' : provider.credential === 'configured' ? 'API Key' : '运行环境'}` : provider.authorization ? '账号登录' : provider.canStoreApiKey ? 'API Key' : providerStatus(provider)}</span></div></div>
                <div className={tw("flex shrink-0 items-center gap-1")}>
                  <Button aria-label={`${group.connected ? '管理' : '连接'}${providerName(provider)}`} className={tw("h-control-sm min-h-control-sm rounded-lg px-3 text-xs")} onPress={() => { setConnectionId(provider.providerId) }} size="sm" variant={group.connected ? 'ghost' : 'outline'}>{group.connected ? '管理' : '连接'}</Button>
                  {group.connected && provider.canDelete ? <Button aria-label={`删除${providerName(provider)}`} className={tw("h-control-sm min-h-control-sm px-2 text-xs text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))]")} isDisabled={!settings.writable} onPress={() => { setDeleteTarget(provider) }} size="sm" variant="ghost">删除</Button> : null}
                </div>
              </div>)}
            </div>
            {!group.connected && !query && availableProviders.length > suggestedProviders.length ? <Button className={tw("mt-2 h-control gap-1 text-xs text-[var(--text-secondary)]")} onPress={() => { setShowAllProviders(!showAllProviders) }} size="sm" variant="ghost">{showAllProviders ? '收起' : `查看全部 ${availableProviders.length} 个提供商`}<Icon className={tw(showAllProviders && 'rotate-180')} name="chevronDown" size={12} /></Button> : null}
          </section>
        })}
        {query && !filteredProviders.length ? <p className={tw("py-6 text-center text-sm text-[var(--text-tertiary)]")}>没有找到匹配的提供商</p> : null}
        <Button className={tw("h-control-lg w-fit gap-2 text-compact")} isDisabled={!settings.writable} onPress={() => { setProviderDialog({ mode: 'create' }) }} variant="ghost"><Icon name="plus" size={15} />自定义提供商</Button>
      </div> : null}
      {settings && connectionProvider && !providerDialog ? <ProviderConnectionDialog key={connectionProvider.providerId} provider={connectionProvider} writable={settings.writable} onClose={() => { setConnectionId(undefined) }} onEdit={draft => { setConnectionId(undefined); setProviderDialog({ mode: 'edit', draft }) }} onSaveApiKey={onSaveApiKey} onAuthorize={onAuthorizeProvider ?? authorizationUnavailable} onSignOut={onSignOutProvider ?? signOutUnavailable} onTest={onTestProvider} /> : null}
      {settings && deleteTarget ? <ProviderDeleteDialog key={deleteTarget.providerId} provider={deleteTarget} writable={settings.writable} onClose={() => { setDeleteTarget(undefined) }} onDelete={async id => {
        const result = await onDeleteProvider(id)
        if (result.accepted) setDeleteTarget(undefined)
        return result
      }} /> : null}
      {providerDialog ? <CustomProviderDialog dialog={providerDialog} key={providerDialog.mode === 'create' ? 'create' : providerDialog.draft.providerId} onClose={() => { setProviderDialog(undefined) }} onSave={providerDialog.mode === 'create' ? onCreateCustomProvider : onUpdateCustomProvider} onTest={onTestProvider} /> : null}
    </section>
  )
}
