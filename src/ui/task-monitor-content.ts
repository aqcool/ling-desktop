import type { LingTimelineAttachment, LingTimelineItem, LingTimelineItemStatus } from '../runtime/contract.js'
import type { LingPresentedFile } from '../runtime/reply-features.js'

export interface TaskMonitorResource {
  readonly id: string
  readonly kind: 'skill' | 'mcp'
  readonly name: string
  readonly taskId: string
  readonly itemId: string
  readonly toolName?: string
  readonly status?: LingTimelineItemStatus
}

export interface TaskMonitorLink {
  readonly id: string
  readonly url: string
  readonly label: string
}

export interface TaskMonitorAttachment {
  readonly id: string
  readonly kind: 'attachment'
  readonly taskId: string
  readonly attachment: LingTimelineAttachment
}

export interface TaskMonitorDelivery {
  readonly id: string
  readonly kind: 'delivery'
  readonly taskId: string
  readonly name: string
  readonly file: LingPresentedFile
}

export type TaskMonitorOutput = TaskMonitorDelivery | TaskMonitorAttachment
export type TaskMonitorSource = TaskMonitorAttachment | (TaskMonitorLink & { readonly kind: 'url' })

export interface TaskMonitorContent {
  readonly resources: readonly TaskMonitorResource[]
  readonly outputs: readonly TaskMonitorOutput[]
  readonly webLinks: readonly TaskMonitorLink[]
  readonly sources: readonly TaskMonitorSource[]
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function jsonObject(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined
  try { return object(JSON.parse(text)) } catch { return undefined }
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

function link(value: unknown, title?: unknown): TaskMonitorLink | undefined {
  const url = httpUrl(value)
  if (!url) return undefined
  const label = typeof title === 'string' && title.trim() ? title.trim() : url.replace(/^https?:\/\//, '')
  return { id: `url:${url}`, url, label }
}

function userLinks(text: string): readonly TaskMonitorLink[] {
  const links: TaskMonitorLink[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`，。；：！？、（）【】]+/g)) {
    let value = match[0].replace(/[.,;:，。；：！？、]+$/, '')
    // Remove Markdown/prose closing punctuation without truncating URL parentheses.
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1)
    }
    const result = link(value)
    if (result) links.push(result)
  }
  return links
}

function skillName(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : undefined
}

function loadedSkill(item: LingTimelineItem): string | undefined {
  if (item.skillInvocation) return skillName(item.skillInvocation.name)
  if (item.kind === 'tool-activity' && item.title === 'skill') {
    return skillName(jsonObject(item.tool?.input)?.['name'])
  }
  return undefined
}

function webResultLinks(item: LingTimelineItem): readonly TaskMonitorLink[] {
  if (item.kind !== 'tool-activity' || item.status !== 'completed') return []
  if (item.title !== 'web_search' && item.title !== 'web_fetch') return []
  const output = jsonObject(item.text)
  if (item.title === 'web_fetch') {
    const result = link(output?.['url'] ?? item.text.match(/^Fetched (https?:\/\/\S+) \(HTTP \d{3}\)/)?.[1], output?.['title'])
    return result ? [result] : []
  }
  if (Array.isArray(output?.['sources'])) {
    return output['sources'].flatMap(source => {
      const entry = object(source)
      const result = link(entry?.['url'], entry?.['title'])
      return result ? [result] : []
    })
  }
  // The pinned DSH search tool renders its returned sources in this section.
  // Snippet URLs and links elsewhere in the provider answer are not source records.
  const sources = item.text.match(/(?:^|\n)Sources:\s*\n([\s\S]*?)(?:\n\s*\n|$)/)?.[1]
  if (!sources) return []
  return [...sources.matchAll(/^- \[((?:\\.|[^\\\]\n])*)\]\((https?:\/\/\S+?)\)(?=\s|$)/gm)].flatMap(match => {
    const result = link(match[2], match[1]?.replace(/\\([\\\[\]])/g, '$1'))
    return result ? [result] : []
  })
}

function attachmentEntry(taskId: string, attachment: LingTimelineAttachment): TaskMonitorAttachment {
  return { id: `attachment:${taskId}:${attachment.attachmentId}`, kind: 'attachment', taskId, attachment }
}

function deliveryPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^(?:\.\/)+/, '')
}

/** Project current-task evidence only; an available skill catalog is not a usage log. */
export function projectTaskMonitorContent(timeline: readonly LingTimelineItem[], taskId?: string): TaskMonitorContent {
  const items: LingTimelineItem[] = []
  const visit = (item: LingTimelineItem) => {
    if (taskId && item.taskId !== taskId) return
    items.push(item)
    item.tool?.children?.forEach(visit)
  }
  timeline.forEach(visit)

  const resources = new Map<string, TaskMonitorResource>()
  const outputs = new Map<string, TaskMonitorOutput>()
  const webLinks = new Map<string, TaskMonitorLink>()
  const sources = new Map<string, TaskMonitorSource>()
  for (const item of items) {
    if (item.kind !== 'user-message') continue
    for (const attachment of item.attachments ?? []) {
      const entry = attachmentEntry(item.taskId, attachment)
      sources.set(entry.id, entry)
    }
    for (const entry of userLinks(item.text)) sources.set(entry.id, { ...entry, kind: 'url' })
  }
  for (const item of items) {
    const name = loadedSkill(item)
    if (name) resources.set(`skill:${name}`, {
      id: `skill:${name}`, kind: 'skill', name, taskId: item.taskId, itemId: item.itemId,
      ...(item.status ? { status: item.status } : {}),
    })
    if (item.kind === 'tool-activity' && /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(item.title ?? '')) {
      const toolName = item.title!
      const id = `mcp:${toolName}`
      resources.set(id, { id, kind: 'mcp', name: toolName.slice(5), toolName, taskId: item.taskId, itemId: item.itemId,
        ...(item.status ? { status: item.status } : {}) })
    }
    for (const entry of webResultLinks(item)) if (!webLinks.has(entry.id)) webLinks.set(entry.id, entry)
    if (item.kind === 'user-message') continue
    for (const attachment of item.attachments ?? []) {
      const entry = attachmentEntry(item.taskId, attachment)
      if (!sources.has(entry.id)) outputs.set(entry.id, entry)
    }
    for (const file of item.presentedFiles ?? []) {
      const path = deliveryPath(file.path)
      const id = `delivery:${item.taskId}:${path}`
      outputs.set(id, { id, kind: 'delivery', taskId: item.taskId, name: path.split('/').at(-1) || path, file })
    }
  }
  return { resources: [...resources.values()], outputs: [...outputs.values()], webLinks: [...webLinks.values()], sources: [...sources.values()] }
}
