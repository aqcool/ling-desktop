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
import { lingDeliverablesDefinition, presentedFiles } from '../src/client/deliverables-projection.js'
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
  events.register(lingDeliverablesDefinition)
  const assembler = new ConversationNodeAssembler(events, views)
  assembler.activateTarget('chat')
  let seq = 0
  function append(type: string, data: unknown, extra = {}) {
    assembler.append({ type: 'event', event: { type, seq: seq++, time: seq * 1000, data, surfaceOp: 'append', ...extra } } as SessionEventLikeEntry)
    assembler.flush()
    return projectConversation('test', assembler.snapshot('chat') as Chat.ChatSnapshot)
  }
  return { append }
}
describe('durable delivery projection through published Chat assembly', () => {
  it('keeps original delivery indexes when invalid entries are skipped', () => {
    expect(presentedFiles(3, {turn: 1, files: [null, {path: 'report.md', description: '报告'}]})).toEqual({turn: 1, files: [{seq: 3, index: 1, path: 'report.md', description: '报告'}]})
    expect(presentedFiles(3, {turn: 0, files: [{path: 'x'}]})).toBeUndefined()
  })
  it('places cards beneath the final reply and updates re-presented paths without duplicates', () => {
    const {append} = fixture()
    append('turn/start', {turn: 1})
    append('deliverables/presented', {turn: 1, callId: 'a', files: [{path: 'report.md', description: '初稿'}]})
    append('deliverables/presented', {turn: 1, callId: 'b', files: [{path: 'report.md', description: '最终报告'}]})
    append('step/start', {turn: 1, step: 1})
    append('assistant/message', {turn: 1, step: 1, stream: [], message: {id: 'reply', source: {provider: 'fixture', model: 'fixture'}, role: 'assistant', content: [{type: 'text', text: '报告已交付。'}]}})
    const result = append('turn/end', {turn: 1, reason: {kind: 'completed'}})
    expect(result.filter(item => item.presentedFiles?.length)).toHaveLength(1)
    expect(result.find(item => item.kind === 'assistant-message')).toMatchObject({turnComplete: true, presentedFiles: [{seq: 2, index: 0, path: 'report.md', description: '最终报告'}]})
  })
  it('keeps a delivery visible without closing text and before the next turn', () => {
    const {append} = fixture()
    append('turn/start', {turn: 1})
    append('deliverables/presented', {turn: 1, callId: 'a', files: [{path: 'report.pdf'}]})
    append('turn/end', {turn: 1, reason: {kind: 'completed'}})
    append('turn/start', {turn: 2})
    const result = append('user/message', {source: {kind: 'user'}, content: [{type: 'text', text: '下一步'}]})
    expect(result[0]?.presentedFiles).toEqual([{seq: 1, index: 0, path: 'report.pdf'}])
    expect(result.at(-1)?.kind).toBe('user-message')
  })
})
