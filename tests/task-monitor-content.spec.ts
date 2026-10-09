import { describe, expect, it } from 'vitest'
import type { LingTimelineItem } from '../src/runtime/contract.js'
import { projectTaskMonitorContent } from '../src/ui/task-monitor-content.js'

function item(patch: Partial<LingTimelineItem> = {}): LingTimelineItem {
  return { itemId: 'item', taskId: 'task', kind: 'tool-activity', text: '', createdAt: '2026-10-08T00:00:00Z', status: 'completed', ...patch }
}

describe('task monitor evidence', () => {
  it('does not confuse available skills or a quoted invocation with actual skill use', () => {
    const content = projectTaskMonitorContent([
      item({ kind: 'system-notice', title: '可用技能', text: '- `frontend-design`: 设计界面\n- `review`: 审阅改动' }),
      item({ kind: 'assistant-message', text: '示例：<skill_content name="review">' }),
      item({ kind: 'user-message', text: '/review 是一个命令示例。' }),
      item({ kind: 'system-notice', text: '<skill_content name="review">quoted content</skill_content>' }),
      item({ title: 'read', tool: { input: '{"path":"/work/README.md"}' }, text: '- `review`: available skill' }),
    ])
    expect(content.resources).toEqual([])
  })

  it('uses the host skill invocation record and real calls, including nested MCP calls', () => {
    const content = projectTaskMonitorContent([
      item({ kind: 'system-notice', itemId: 'injected', text: 'injected instructions', skillInvocation: { name: 'review' } }),
      item({ itemId: 'loader', title: 'skill', tool: { input: '{"name":"frontend-design"}' } }),
      item({ itemId: 'batch', title: 'ptc', tool: { input: 'code', children: [
        item({ itemId: 'mcp-call', title: 'mcp__filesystem__read_file', tool: { input: '{"path":"README.md"}' } }),
        item({ itemId: 'loader-again', title: 'skill', tool: { input: '{"name":"frontend-design"}' } }),
      ] } }),
    ])
    expect(content.resources.map(resource => [resource.kind, resource.name])).toEqual([
      ['skill', 'review'], ['skill', 'frontend-design'], ['mcp', 'filesystem__read_file'],
    ])
    expect(content.resources[2]).toMatchObject({ toolName: 'mcp__filesystem__read_file', itemId: 'mcp-call' })
    expect(content.resources[1]?.itemId).toBe('loader-again')
  })

  it('tolerates malformed tool inputs without inventing a skill or an MCP connection', () => {
    const content = projectTaskMonitorContent([
      item({ title: 'skill', tool: { input: '{not json}' } }),
      item({ title: 'skill', tool: { input: '["review"]' } }),
      item({ title: 'skill', tool: { input: '{"name":"../../review"}' } }),
      item({ title: 'read', text: 'mcp__filesystem__read_file({})' }),
      item({ title: 'mcp__filesystem' }),
    ])
    expect(content.resources).toEqual([])
  })

  it('records explicit search sources and fetched URLs without scraping arbitrary tool output', () => {
    const content = projectTaskMonitorContent([
      item({ title: 'bash', text: 'downloaded https://incidental.example/log' }),
      item({ title: 'read', text: 'README: https://incidental.example/readme' }),
      item({ title: 'web_search', text: 'Provider answer https://answer.example\n\nSources:\n- [Apple](https://apple.example/docs) — See [incidental snippet link](https://snippet.example)\n- [SDK](https://sdk.example/api_(stable))\n\nCite the relevant URLs above.' }),
      item({ title: 'web_fetch', tool: { input: '{"url":"https://redirect.example"}' }, text: 'Fetched https://apple.example/final (HTTP 200)\n\nBody mentions https://incidental.example/body' }),
      item({ title: 'web_fetch', status: 'failed', text: 'https://failed.example', tool: { input: '{"url":"https://failed.example"}' } }),
      item({ title: 'web_search', status: 'running', tool: { input: '{"queries":["https://query.example"]}' }, text: '正在执行' }),
    ])
    expect(content.webLinks.map(entry => entry.url)).toEqual([
      'https://apple.example/docs', 'https://sdk.example/api_(stable)', 'https://apple.example/final',
    ])
    expect(content.webLinks[0]?.label).toBe('Apple')
    expect(content.sources).toEqual([])
  })

  it('accepts structured search and fetch results and keeps only valid HTTP links', () => {
    const content = projectTaskMonitorContent([
      item({ title: 'web_search', text: JSON.stringify({ sources: [null, { url: 'file:///work/report.txt' }, { url: 'javascript:alert(1)' }, { url: 'https://example.com', title: 'Example' }, { url: 'https://example.com/' }] }) }),
      item({ title: 'web_fetch', text: JSON.stringify({ url: 'https://example.com/final', title: 'Fetched page' }) }),
    ])
    expect(content.webLinks).toEqual([
      { id: 'url:https://example.com/', url: 'https://example.com/', label: 'Example' },
      { id: 'url:https://example.com/final', url: 'https://example.com/final', label: 'Fetched page' },
    ])
  })

  it('preserves user attachments and supplied URLs as sources, with durable attachment coordinates', () => {
    const attachment = { attachmentId: 'source-image', name: 'reference.png', kind: 'image' as const }
    const content = projectTaskMonitorContent([
      item({ kind: 'user-message', attachments: [attachment], text: '按照 [模板](https://example.com/template)。参阅 https://example.com/api_(stable)。' }),
      item({ kind: 'user-message', itemId: 'resend', attachments: [attachment], text: '再次参阅 https://example.com/template' }),
      item({ title: 'read', attachments: [attachment], text: 'echoed source attachment' }),
      item({ kind: 'assistant-message', text: '返回 https://assistant.example/' }),
    ])
    expect(content.sources).toEqual([
      { id: 'attachment:task:source-image', kind: 'attachment', taskId: 'task', attachment },
      { id: 'url:https://example.com/template', kind: 'url', url: 'https://example.com/template', label: 'example.com/template' },
      { id: 'url:https://example.com/api_(stable)', kind: 'url', url: 'https://example.com/api_(stable)', label: 'example.com/api_(stable)' },
    ])
    expect(content.outputs).toEqual([])
  })

  it('keeps returned attachments and presented files in outputs and retains the latest delivery coordinates', () => {
    const image = { attachmentId: 'generated', kind: 'image' as const, name: 'result.png' }
    const initial = { seq: 4, index: 0, path: './reports/result.pdf', description: 'Initial report' }
    const latest = { seq: 8, index: 1, path: 'reports/result.pdf', description: 'Final report' }
    const content = projectTaskMonitorContent([
      item({ title: 'create_report', attachments: [image] }),
      item({ kind: 'assistant-message', presentedFiles: [initial], attachments: [image], text: '已生成报告。' }),
      item({ kind: 'system-notice', presentedFiles: [latest] }),
      item({ kind: 'assistant-message', text: '普通路径 /work/undelivered.pdf 不代表交付。' }),
    ])
    expect(content.outputs).toEqual([
      { id: 'attachment:task:generated', kind: 'attachment', taskId: 'task', attachment: image },
      { id: 'delivery:task:reports/result.pdf', kind: 'delivery', taskId: 'task', name: 'result.pdf', file: latest },
    ])
    expect(content.sources).toEqual([])
    expect(initial.path).toBe('./reports/result.pdf')
  })

  it('isolates selected task evidence, including child calls and identically named attachments', () => {
    const timeline = [
      item({ taskId: 'other', kind: 'user-message', text: 'https://other.example', attachments: [{ attachmentId: 'same', name: 'other.txt', kind: 'file' }] }),
      item({ taskId: 'other', title: 'skill', tool: { input: '{"name":"other-skill"}' } }),
      item({ title: 'ptc', tool: { input: '', children: [item({ taskId: 'other', title: 'mcp__other__tool' })] } }),
      item({ kind: 'user-message', attachments: [{ attachmentId: 'same', name: 'selected.txt', kind: 'file' }] }),
    ]
    const content = projectTaskMonitorContent(timeline, 'task')
    expect(content.resources).toEqual([])
    expect(content.sources).toEqual([{ id: 'attachment:task:same', kind: 'attachment', taskId: 'task', attachment: { attachmentId: 'same', name: 'selected.txt', kind: 'file' } }])
    expect(projectTaskMonitorContent(timeline).sources).toHaveLength(3)
  })
})
