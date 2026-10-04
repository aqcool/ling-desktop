import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import * as stores from '@deepseek-ai/dsh-client-store'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import type * as Conversation from '@deepseek-ai/dsh-client-ui-conversation/client'
import type * as Chat from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, describe, expect, it } from 'vitest'
import { lingCompactionDefinition, lingCompactionBoundaryDefinition } from '../src/client/compaction-projection.js'
import { projectConversation } from '../src/client/conversation-projection.js'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

// Published browser packages expose ModuleLoader factories, not Node ESM values.
// Execute their actual assembly code; rendering seats are never mounted here.
const dependencies: Record<string, unknown> = {
  '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': stores,
  react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM,
  '@deepseek-ai/dsh-client-ui-primitives': {}, '@deepseek-ai/dsh-client-ui-slots': {},
}
async function browserModule<T>(specifier: string): Promise<T> {
  const source = await readFile(createRequire(import.meta.url).resolve(specifier), 'utf8')
  let result: T | undefined
  new Function('window', source)({ __ModuleLoader__: { load: ({ factory }: { factory(require: (id: string) => unknown): T }) => {
    result = factory(id => { if (!(id in dependencies)) throw new Error(`Unexpected browser dependency: ${id}`); return dependencies[id] })
  } } })
  return result!
}
const { ConversationEventRegistry, ConversationViewRegistry, ConversationNodeAssembler, UiConversation } = await browserModule<typeof Conversation>('@deepseek-ai/dsh-client-ui-conversation/client')
const { apply: applyChat } = await browserModule<typeof Chat>('@deepseek-ai/dsh-client-ui-chat/client')

function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const events = new ConversationEventRegistry(ctx)
  const views = new ConversationViewRegistry(ctx)
  ctx.provide('uiConversation', { events, views, inspectSystemPrompt: UiConversation.prototype.inspectSystemPrompt, inspectRequestPrompt: UiConversation.prototype.inspectRequestPrompt } as never)
  ctx.provide('slots', { inject: () => () => {} } as never)
  ctx.provide('uiSession', { provide: () => () => {} } as never)
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
  ctx.provide('settingsScope', { bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({}) }) } as never)
  // The published Chat plugin registers the real view builder and legacy rows.
  applyChat(ctx)
  events.register(lingCompactionDefinition); events.register(lingCompactionBoundaryDefinition)
  const assembler = new ConversationNodeAssembler(events, views)
  assembler.activateTarget('chat')
  let seq = 0
  function append(type: string, data: unknown, extra = {}) {
    assembler.append({ type: 'event', event: { type, seq: seq++, time: seq * 1000, data, ...extra } } as SessionEventLikeEntry)
    assembler.flush()
    return projectConversation('test', assembler.snapshot('chat') as Chat.ChatSnapshot)
  }
  return { append }
}
const summary = { compactionId: 'compact', summary: [{ type: 'text', text: '工程摘要\n保留待办与约束。' }], shadowedRange: { start: 1, end: 8 }, shadowedSeqs: [1, 3, 8], shadowedTokenCount: 12000, provider: 'test', model: 'summary' }
const checkpoint = { source: { kind: 'plugin', plugin: 'compact', compactionId: 'compact' }, content: summary.summary }
const replacement = { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 8 }, sourceEventSeqs: [1, 3, 8] }

describe('compaction through published DSH assembly and Chat projection', () => {
  it('has one stable row across progress, checkpoint and completion without exposing the whole summary', () => {
    const { append } = fixture()
    append('turn/start', { turn: 1 })
    const started = append('compaction/start', { compactionId: 'compact', turn: 1 })
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ status: 'running', title: '正在整理上下文' })
    append('compaction/summary', summary)
    expect(append('user/message', checkpoint, replacement)[0]?.status).toBe('running')
    const result = append('compaction/end', { compactionId: 'compact', turn: 1 })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ itemId: started[0]!.itemId, status: 'completed', compaction: { checkpointLanded: true, itemCount: 3, tokenCount: 12000, range: { start: 1, end: 8 }, summary: '工程摘要\n保留待办与约束。', canRetry: false } })
    expect(result[0]!.text).not.toContain('工程摘要')
  })
  it('does not duplicate a manual command, and retains ordinary no-op command results', () => {
    const { append } = fixture()
    append('command/run', { commandId: 'command', name: 'compact' })
    append('compaction/start', { compactionId: 'compact', sourceCommandId: 'command', turn: null })
    append('compaction/summary', { ...summary, sourceCommandId: 'command' })
    append('user/message', { ...checkpoint, source: { ...checkpoint.source, sourceCommandId: 'command' } }, replacement)
    append('compaction/end', { compactionId: 'compact', sourceCommandId: 'command', turn: null })
    const result = append('command/done', { commandId: 'command', kind: 'success', text: '已完成', sourceEventSeq: 3 })
    expect(result).toHaveLength(1)
    expect(result[0]!.compaction?.checkpointLanded).toBe(true)
    const noop = fixture()
    noop.append('command/run', { commandId: 'noop', name: 'compact' })
    expect(noop.append('command/done', { commandId: 'noop', kind: 'success', text: '无需整理' })[0]?.text).toBe('无需整理')
  })
  it('allows retry after a model failure but never claims a landed checkpoint was rolled back', () => {
    const { append } = fixture()
    append('compaction/start', { compactionId: 'compact', turn: null })
    const failed = append('compaction/end', { compactionId: 'compact', turn: null, error: 'fetch failed' })
    expect(failed[0]).toMatchObject({ status: 'failed', compaction: { canRetry: true, checkpointLanded: false } })
    const landed = fixture()
    landed.append('compaction/start', { compactionId: 'compact', turn: null })
    landed.append('user/message', checkpoint, replacement)
    const ended = landed.append('compaction/end', { compactionId: 'compact', turn: null, error: 'flush failed' })
    expect(ended[0]!.text).toContain('摘要已写入')
    expect(ended[0]!.compaction?.canRetry).toBe(false)
  })
  it('settles abandoned transactions after turn end or session resume', () => {
    const automatic = fixture()
    automatic.append('turn/start', { turn: 1 })
    automatic.append('compaction/start', { compactionId: 'compact', turn: 1 })
    expect(automatic.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })[0]?.status).toBe('interrupted')
    const manual = fixture()
    manual.append('compaction/start', { compactionId: 'compact', turn: null })
    expect(manual.append('session/end-seed', {})[0]).toMatchObject({ status: 'interrupted', compaction: { canRetry: true } })
  })
  it('does not fabricate counts when only a checkpoint is loaded', () => {
    const { append } = fixture()
    const result = append('user/message', checkpoint, replacement)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ status: 'completed', text: '早期记录已整理' })
    expect(result[0]!.compaction?.itemCount).toBeUndefined()
  })
})
