import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LingHooksController } from '../src/host/hooks-controller.ts'
import { LingSessionLifecycle } from '../src/session-lifecycle.ts'
import { HooksStore, importHooks } from '../src/hooks-manager.ts'
import type { LingHookDialect, LingHookEntry, LingHooksRequest, LingHooksResponse } from '../../src/runtime/hooks.ts'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllEnvs() })
function directory() { const dir = mkdtempSync(join(tmpdir(), 'ling-hooks-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir }
const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const entry = (event: LingHookEntry['event'], command: string, matcher = ''): LingHookEntry => ({ id: `${event}-fixture`, event, command, matcher, timeoutSec: 10, enabled: true })
function text(text: string): StreamChunk[] { return [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }] }
function tool(): StreamChunk[] { return [{ type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id: ToolCallId('fixture-call'), name: 'danger', argumentsDelta: '{}' }, { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('fixture-call'), name: 'danger', arguments: '{}' } }, { type: 'finish', reason: { kind: 'tool-calls' } }] }
class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private script: StreamChunk[][]) { super() }
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { this.requests.push(options); const chunks = this.script.shift(); if (!chunks) throw new Error('fixture script exhausted'); for (const chunk of chunks) yield chunk }
}
async function fixture(home = directory()) {
  const workspace = directory(), ctx = new Context()
  vi.stubEnv('DSH_HOME', home)
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime, {}); await ctx.plugin(AgentRegistry); await ctx.plugin(LingSessionLifecycle, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime); await ctx.plugin(LocalBashExecutor, { timeoutMs: 10000 })
  await ctx.plugin(TypertRegistry); await ctx.plugin(TypertGatewayService); await ctx.plugin(LingHooksController)
  const request = (request: LingHooksRequest): Promise<LingHooksResponse> => ctx.typertGateway.invoke({ namespace: 'lingHooks', method: 'request', args: { request }, signal: new AbortController().signal }) as Promise<LingHooksResponse>
  const save = async (entries: LingHookEntry[], dialect: LingHookDialect = 'claude-code', enabled = true) => { const before = (await request({ type: 'snapshot' })).snapshot!; return (await request({ type: 'save', revision: before.revision, settings: { enabled, dialect, entries } })).snapshot! }
  return { ctx, home, workspace, request, save }
}
async function createFixtureAgent(ctx: Context, id: string, workspace: string) { return (await ctx.lingSessionLifecycle.createAgent(ctx, { sessionId: SessionId(id), agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: workspace } })).agent }
describe('LING Hooks management with official engines', () => {
  it.each(['claude-code', 'codex'] as const)('runs real %s command hooks in a real agent loop; injects context, denies tools and persists outcomes', async dialect => {
    const { ctx, workspace, request, save, home } = await fixture()
    const prompt = join(workspace, 'prompt.sh'), deny = join(workspace, 'deny.sh'), received = join(workspace, 'received.json')
    writeFileSync(prompt, `cat > ${quoted(received)}\nprintf '%s\\n' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"hook context from disk"}}'\n`)
    writeFileSync(deny, 'printf "%s\\n" "danger blocked by LING hook" >&2\nexit 2\n')
    const configured = await save([entry('UserPromptSubmit', `bash ${quoted(prompt)}`), entry('PreToolUse', `bash ${quoted(deny)}`, 'danger')], dialect)
    expect(configured).toMatchObject({ state: 'loaded', activeCount: 2, scope: 'process' })
    const model = new ScriptedModel([tool(), text('done'), tool(), text('allowed')])
    ctx.llm.registerAdapter(['fixture'], model)
    const body = vi.fn(async () => [{ type: 'text' as const, text: 'must not run' }])
    ctx.tools.register(defineContentToolFixture({ name: 'danger', description: 'fixture tool', parameters: {}, execute: body }))
    const agent = await createFixtureAgent(ctx, `hooks-${dialect}`, workspace)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'use danger' }] }))
    await agent.whenIdle()
    expect(body).not.toHaveBeenCalled()
    expect(JSON.stringify(model.requests[0]?.messages)).toContain('hook context from disk')
    expect(JSON.parse(readFileSync(received, 'utf8'))).toMatchObject({ hook_event_name: 'UserPromptSubmit', cwd: workspace })
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'hook/result').map(event => event.data)).toEqual(expect.arrayContaining([expect.objectContaining({ point: 'PreToolUse', exitCode: 2, decision: 'block' })]))
    expect((await request({ type: 'snapshot' })).snapshot!.history).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: agent.id, point: 'PreToolUse', exitCode: 2 })]))
    expect(new HooksStore(home).settings.dialect).toBe(dialect)
    // Disabling disposes listeners, not agent handles; the next real tool call runs.
    await save(configured.settings.entries, dialect, false)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'use danger again' }] }))
    await agent.whenIdle()
    expect(body).toHaveBeenCalledOnce()
    expect(ctx.agents.get(agent.id)).toBe(agent)
  })
  it('refuses changes while a real agent is reserved, rejects stale revisions and invalid matchers without changing the loaded configuration', async () => {
    const { ctx, save, request, home, workspace } = await fixture()
    const active = await save([entry('PreToolUse', 'printf "blocked" >&2; exit 2', 'danger')])
    const model = new ScriptedModel([text('ok')]); ctx.llm.registerAdapter(['fixture'], model)
    const agent = await createFixtureAgent(ctx, 'busy-hooks', workspace)
    const runtime = Reflect.get(ctx.lingHooks, 'runtime') as { uid: number | null }
    let release!: () => void
    const lease = agent.runMaintenance(async () => { await new Promise<void>(resolve => { release = resolve }) })
    await expect(save([], 'claude-code', false)).rejects.toThrow()
    expect(Reflect.get(ctx.lingHooks, 'runtime')).toBe(runtime)
    expect(runtime.uid).not.toBeNull()
    release(); await lease
    await expect(request({ type: 'save', revision: active.revision - 1, settings: active.settings })).rejects.toThrow(/刷新/)
    await expect(save([entry('PreToolUse', 'true', '[')])).rejects.toThrow()
    expect(new HooksStore(home).settings).toEqual(active.settings)
    expect((await request({ type: 'snapshot' })).snapshot).toMatchObject({ state: 'loaded', activeCount: 1, revision: active.revision })
  })
  it('loads saved enabled hooks on the next Host startup and blocks a prompt before the model runs', async () => {
    const before = await fixture()
    const saved = await before.save([entry('UserPromptSubmit', 'printf "prompt blocked" >&2; exit 2')])
    await before.ctx.fiber.dispose()
    const after = await fixture(before.home), model = new ScriptedModel([text('must not run')])
    expect((await after.request({ type: 'snapshot' })).snapshot).toMatchObject({ state: 'loaded', revision: saved.revision, activeCount: 1 })
    after.ctx.llm.registerAdapter(['fixture'], model)
    const agent = await createFixtureAgent(after.ctx, 'hooks-after-startup', after.workspace)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'blocked prompt' }] }))
    await agent.whenIdle()
    expect(model.requests).toHaveLength(0)
    expect((await after.request({ type: 'snapshot' })).snapshot!.history).toMatchObject([{ point: 'UserPromptSubmit', decision: 'block', exitCode: 2 }])
  })
  it('gates new-agent publication during reload so SessionStart uses the new configuration without nesting maintenance or losing the task', async () => {
    const { ctx, save, workspace } = await fixture()
    const started = join(workspace, 'session-start.txt')
    await save([entry('SessionStart', `printf old > ${quoted(started)}`)])
    ctx.llm.registerAdapter(['fixture'], new ScriptedModel([text('ready')]))
    const runtime = Reflect.get(ctx.lingHooks, 'runtime') as { dispose(): Promise<void> }
    const original = runtime.dispose.bind(runtime)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const disposing = vi.spyOn(runtime, 'dispose').mockImplementation(async () => { await held; await original() })
    const pending = save([entry('SessionStart', `printf new > ${quoted(started)}`)])
    await vi.waitFor(() => expect(disposing).toHaveBeenCalledOnce())
    let created = false
    const creating = createFixtureAgent(ctx, 'created-during-hooks-apply', workspace).then(agent => { created = true; return agent })
    await Promise.resolve()
    expect(ctx.agents.get(SessionId('created-during-hooks-apply'))).toBeUndefined()
    expect(created).toBe(false)
    release()
    expect(await pending).toMatchObject({ state: 'loaded' })
    const agent = await creating
    expect(readFileSync(started, 'utf8')).toBe('new')
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] }))
    await agent.whenIdle()
    expect(ctx.agents.get(agent.id)).toBe(agent)
    expect(agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(true)
  })
  it('imports only explicit supported commands without touching the source, bounds input and refuses symlink write targets', async () => {
    const dir = directory(), source = join(dir, 'settings.json'), raw = JSON.stringify({ unrelated: 42, hooks: { PreToolUse: [{ matcher: 'danger', hooks: [{ type: 'command', command: 'echo hi', timeout: 3 }] }] } })
    writeFileSync(source, raw)
    expect(importHooks(source, 'claude-code')).toMatchObject([{ event: 'PreToolUse', command: 'echo hi', timeoutSec: 3 }])
    expect(readFileSync(source, 'utf8')).toBe(raw)
    writeFileSync(source, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'ignored' }] }] } }))
    expect(() => importHooks(source, 'claude-code')).toThrow(/command/)
    writeFileSync(source, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true', async: true }] }] } }))
    expect(() => importHooks(source, 'codex')).toThrow(/同步/)
    writeFileSync(source, ' '.repeat(1024 * 1024 + 1))
    expect(() => importHooks(source, 'codex')).toThrow(/1 MB/)
    const store = new HooksStore(dir), target = join(dir, 'external.json')
    writeFileSync(target, 'preserve'); symlinkSync(target, store.configPath)
    expect(() => store.commit({ enabled: false, dialect: 'claude-code', entries: [] })).toThrow(/普通文件/)
    expect(readFileSync(target, 'utf8')).toBe('preserve')
  })
})
