import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError,
  type AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LING_AUTHORIZATION_HOST } from '../authorization-contract.ts'
import type {
  LingAuthorizationEntryView,
  LingAuthorizationFrame,
  LingAuthorizationPollResult,
  LingAuthorizationPromptView,
} from '../authorization-contract.ts'

interface PendingPrompt {
  readonly promptId: string
  readonly resolve: (value: string) => void
  readonly reject: (reason: Error) => void
  readonly cleanup: () => void
}

interface Attempt {
  readonly attemptId: string
  readonly key: string
  readonly events: LingAuthorizationFrame[]
  readonly wake: Set<() => void>
  nextSeq: number
  done: boolean
  prompt?: PendingPrompt
}

type WithoutSequence<Frame> = Frame extends unknown ? Omit<Frame, 'seq'> : never
type PendingFrame = WithoutSequence<LingAuthorizationFrame>

declare module '@deepseek-ai/cordis' {
  interface Context {
    lingAuthorization: LingAuthorizationController
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('unsupported_country_region_territory')) {
    return '授权码已收到，但 OpenAI 拒绝了令牌兑换（403：当前网络地区不受支持）。账号尚未连接，请检查后台网络配置后重新登录。'
  }
  return message
}

function localizedText(value: string): string {
  switch (value) {
    case 'Select OpenAI Codex login method:': return '选择 OpenAI Codex 登录方式：'
    case 'Browser login (default)': return '浏览器登录（推荐）'
    case 'Device code login (headless)': return '设备码登录'
    case 'A browser window should open. Complete login to finish.': return '请在浏览器中完成登录。'
    case 'Complete login in your browser, or paste the authorization code / redirect URL here:':
      return '请在浏览器中完成登录，或在这里粘贴授权码或回调地址。'
    case 'Enter this code on the verification page to finish signing in.': return '请在验证页面输入此代码完成登录。'
    case 'Open this page to continue signing in.': return '打开登录页面以继续。'
    case 'Signing in…': return '正在登录…'
    default: return value
  }
}

function promptView(prompt: AuthorizationPrompt): LingAuthorizationPromptView {
  if (prompt.kind === 'select') {
    return {
      kind: prompt.kind,
      message: localizedText(prompt.message),
      options: prompt.options.map(option => ({
        id: option.id,
        label: localizedText(option.label),
        ...(option.description === undefined ? {} : { description: localizedText(option.description) }),
      })),
    }
  }
  return {
    kind: prompt.kind,
    message: localizedText(prompt.message),
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
  }
}

export class LingAuthorizationController extends TypertRemoteService {
  static inject = ['authorization', 'credentials', 'typert']

  private readonly attempts = new Map<string, Attempt>()

  constructor(ctx: Context) {
    super(ctx, 'lingAuthorization')
    ctx.effect(() => ctx.typert.register(LING_AUTHORIZATION_HOST), 'LING authorization Remote contract')
    ctx.effect(() => () => {
      for (const attempt of this.attempts.values()) this.withdraw(attempt)
      this.attempts.clear()
    }, 'LING authorization attempts')
  }

  async list(): Promise<readonly LingAuthorizationEntryView[]> {
    const entries = this.ctx.authorization.list()
    return await Promise.all(entries.map(async entry => {
      const record = await this.ctx.credentials.describeRecord(entry.key)
      return {
        key: entry.key,
        providerId: entry.key.slice(entry.key.indexOf('/') + 1),
        label: entry.label,
        methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
        configured: record.configured,
        writable: record.writable,
        inFlight: entry.inFlight,
      }
    }))
  }

  start(keyValue: string, method: string): { readonly attemptId: string } {
    const key = parseCredentialKey(keyValue)
    const entry = this.ctx.authorization.describe(key)
    if (entry === undefined) throw new RemoteError('gateway/bad-request', `没有找到 ${keyValue} 的登录方式。`, {})
    const attempt: Attempt = {
      attemptId: randomUUID(),
      key,
      events: [],
      wake: new Set(),
      nextSeq: 1,
      done: false,
    }
    this.attempts.set(attempt.attemptId, attempt)
    void this.ctx.authorization.begin({
      key,
      ...(method ? { method } : {}),
      interaction: {
        notify: notice => {
          this.push(attempt, {
            type: 'notice',
            message: localizedText(notice.message),
            ...(notice.url === undefined ? {} : { url: notice.url }),
            ...(notice.code === undefined ? {} : { code: notice.code }),
          })
        },
        prompt: prompt => this.prompt(attempt, prompt),
      },
    }).then(outcome => {
      this.finish(attempt, { type: 'settled', status: outcome.status })
    }, error => {
      this.finish(attempt, { type: 'failed', message: errorMessage(error) })
    })
    return { attemptId: attempt.attemptId }
  }

  async poll(attemptId: string, afterSeq: number, signal: AbortSignal): Promise<LingAuthorizationPollResult> {
    const attempt = this.attempt(attemptId)
    while (!attempt.done && !attempt.events.some(event => event.seq > afterSeq)) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          signal.removeEventListener('abort', finish)
          attempt.wake.delete(finish)
          resolve()
        }
        attempt.wake.add(finish)
        signal.addEventListener('abort', finish, { once: true })
        if (signal.aborted) finish()
      })
      if (signal.aborted) break
    }
    return { events: attempt.events.filter(event => event.seq > afterSeq), done: attempt.done }
  }

  answer(attemptId: string, promptId: string, value: string): { readonly ok: true } {
    const attempt = this.attempt(attemptId)
    const pending = attempt.prompt
    if (pending === undefined || pending.promptId !== promptId) {
      throw new RemoteError('gateway/bad-request', '登录问题已经失效。', {})
    }
    attempt.prompt = undefined
    pending.cleanup()
    pending.resolve(value)
    return { ok: true }
  }

  cancel(attemptId: string): { readonly ok: true } {
    const attempt = this.attempt(attemptId)
    this.withdraw(attempt)
    this.ctx.authorization.cancel(parseCredentialKey(attempt.key))
    return { ok: true }
  }

  async signOut(keyValue: string): Promise<{ readonly ok: true }> {
    const key = parseCredentialKey(keyValue)
    this.ctx.authorization.cancel(key)
    await this.ctx.credentials.deleteRecord(key)
    return { ok: true }
  }

  private attempt(attemptId: string): Attempt {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) throw new RemoteError('gateway/bad-request', '登录流程不存在或已结束。', {})
    return attempt
  }

  private push(attempt: Attempt, frame: PendingFrame): void {
    if (attempt.done) return
    attempt.events.push({ ...frame, seq: attempt.nextSeq } as LingAuthorizationFrame)
    attempt.nextSeq += 1
    for (const wake of [...attempt.wake]) wake()
  }

  private finish(attempt: Attempt, frame: PendingFrame): void {
    if (attempt.done) return
    this.push(attempt, frame)
    attempt.done = true
    attempt.prompt?.reject(new AuthorizationDeclinedError())
    attempt.prompt?.cleanup()
    attempt.prompt = undefined
    for (const wake of [...attempt.wake]) wake()
    const timer = setTimeout(() => { this.attempts.delete(attempt.attemptId) }, 60_000)
    timer.unref()
  }

  private withdraw(attempt: Attempt): void {
    attempt.prompt?.reject(new AuthorizationDeclinedError())
    attempt.prompt?.cleanup()
    attempt.prompt = undefined
  }

  private prompt(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
    if (attempt.prompt !== undefined) return Promise.reject(new Error('登录流程同时发出了多个问题。'))
    const promptId = randomUUID()
    const pending = Promise.withResolvers<string>()
    const withdrawn = (): void => {
      if (attempt.prompt?.promptId !== promptId) return
      attempt.prompt = undefined
      this.push(attempt, { type: 'prompt-dismissed', promptId })
      pending.reject(new Error('登录问题已撤回。'))
    }
    prompt.signal?.addEventListener('abort', withdrawn, { once: true })
    const cleanup = (): void => { prompt.signal?.removeEventListener('abort', withdrawn) }
    attempt.prompt = { promptId, resolve: pending.resolve, reject: pending.reject, cleanup }
    this.push(attempt, { type: 'prompt', promptId, prompt: promptView(prompt) })
    return pending.promise
  }
}

type AuthorizationRemoteMethod = 'list' | 'start' | 'poll' | 'answer' | 'cancel' | 'signOut'

function exposeRemoteMethod(method: AuthorizationRemoteMethod): void {
  const prototype = LingAuthorizationController.prototype
  const implementation = prototype[method]
  const receiver = Object.create(prototype) as LingAuthorizationController
  const decorate = Remote as unknown as (
    implementation: (...args: never[]) => unknown,
    context: {
      readonly name: string
      readonly private: boolean
      readonly static: boolean
      addInitializer(initializer: (this: LingAuthorizationController) => void): void
    },
  ) => void
  decorate(implementation as (...args: never[]) => unknown, {
    name: method,
    private: false,
    static: false,
    addInitializer(initializer) { initializer.call(receiver) },
  })
}

for (const method of ['list', 'start', 'poll', 'answer', 'cancel', 'signOut'] as const) {
  exposeRemoteMethod(method)
}

export default LingAuthorizationController
