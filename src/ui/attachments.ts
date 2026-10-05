import type { LingImageMediaType, LingPromptAttachment } from '../runtime/contract.js'

export interface WorkspaceContextReference {
  readonly kind: 'file' | 'directory' | 'selection'
  readonly path: string
  readonly server?: { readonly id: string; readonly label: string }
  readonly text?: string
  /** One-based, inclusive original editor line numbers. */
  readonly startLine?: number
  readonly endLine?: number
}

/** Relative pointers resolve within a workspace or a server's development directory. */
export function workspaceContextScope(source: { readonly workspaceId?: string; readonly serverId?: string; readonly cwd?: string }): string {
  return JSON.stringify(source.serverId
    ? ['server', source.serverId, source.cwd ?? null]
    : ['workspace', source.workspaceId ?? null])
}

export interface ComposerAttachment {
  readonly id: string
  readonly attachment: LingPromptAttachment
  readonly name: string
  readonly size: number
  readonly isImage: boolean
  readonly previewUrl?: string
  readonly quote?: string
  readonly context?: WorkspaceContextReference
}

const imageMediaTypes: Record<string, LingImageMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
}

function nextId(): string {
  return `att-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

/** Keep quoted replies on the existing Markdown attachment transport. */
export function toComposerQuote(text: string, preview = text): ComposerAttachment {
  const data = new TextEncoder().encode(text)
  const name = 'Agent 回复.md'
  return { id: nextId(), name, size: data.byteLength, isImage: false, quote: preview, attachment: { kind: 'file', data, name } }
}

function normalizedWorkspaceContext(reference: WorkspaceContextReference): WorkspaceContextReference {
  if (!['file', 'directory', 'selection'].includes(reference.kind) || typeof reference.path !== 'string'
    || !reference.path.length || reference.path.includes('\0')) throw new Error('工作区引用的路径无效。')
  const server = reference.server
  if (server && (!server.id || !server.label || server.id.includes('\0') || server.label.includes('\0'))) throw new Error('服务器引用无效。')
  if (reference.kind !== 'selection') return { kind: reference.kind, path: reference.path, ...(server ? { server } : {}) }
  if (typeof reference.text !== 'string' || !reference.text.length) throw new Error('请先选择要引用的代码。')
  const startLine = reference.startLine
  const endLine = reference.endLine ?? startLine
  if ((startLine !== undefined && (!Number.isSafeInteger(startLine) || startLine < 1))
    || (endLine !== undefined && (!Number.isSafeInteger(endLine) || startLine === undefined || endLine < startLine))) {
    throw new Error('代码选区的行范围无效。')
  }
  return { kind: 'selection', path: reference.path, text: reference.text, ...(server ? { server } : {}),
    ...(startLine === undefined ? {} : { startLine, endLine }) }
}

function contextBasename(path: string): string {
  return path.replace(/[\\/]+$/u, '').split(/[\\/]/u).at(-1) || path
}

function contextTransportName(path: string): string {
  const sanitized = contextBasename(path).replace(/[\u0000-\u001f\u007f<>:"\/\\|?*]/gu, '_').trim().replace(/[. ]+$/gu, '')
  const stem = sanitized && !/^_+$/u.test(sanitized) ? sanitized : 'workspace'
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(stem) ? 'workspace-' : ''}${stem}.context.md`
}

function lineRange(reference: WorkspaceContextReference): string | undefined {
  if (reference.kind !== 'selection' || reference.startLine === undefined) return undefined
  return reference.endLine === undefined || reference.endLine === reference.startLine
    ? String(reference.startLine) : `${String(reference.startLine)}–${String(reference.endLine)}`
}

/** Delimit arbitrary filenames and source text without changing their contents. */
function fencedContext(text: string): string {
  let longest = 0
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${text}${text.endsWith('\n') ? '' : '\n'}${fence}`
}

export function workspaceContextPresentation(reference: WorkspaceContextReference): { label: string; title: string; typeLabel: string } {
  const range = lineRange(reference)
  const name = contextBasename(reference.path)
  return {
    label: reference.kind === 'selection' ? `${name}${range ? `:${range}` : ' · 代码选区'}` : name,
    title: `${reference.server ? `${reference.server.label} · ` : ''}${reference.path}${range ? `:${range}` : ''}`,
    typeLabel: reference.kind === 'directory' ? '目录' : reference.kind === 'selection' ? '选区' : '文件',
  }
}

/** File pointers and selected editor text use the existing Markdown transport. */
export function toComposerWorkspaceContext(reference: WorkspaceContextReference): ComposerAttachment {
  const context = normalizedWorkspaceContext(reference)
  const presentation = workspaceContextPresentation(context)
  const sections = [
    `# 工作区${context.kind === 'directory' ? '目录' : context.kind === 'selection' ? '代码选区' : '文件'}引用`,
    `原始工作区路径：\n\n${fencedContext(context.path)}`,
  ]
  if (context.server) sections.push(`远程服务器：\n\n${fencedContext(`${context.server.label}\nserverId: ${context.server.id}`)}\n\n此路径位于该服务器，不是本地工作区。请使用对应服务器的文件工具。`)
  if (context.kind === 'selection') {
    const range = lineRange(context)
    if (range) sections.push(`原始行范围：${range}（从 1 开始，包含起止行）。`)
    sections.push(`选中的原始文本（保留编辑器中的内容，可能包含尚未保存的修改）：\n\n${fencedContext(context.text!)}`)
  } else {
    sections.push(context.server ? '这是远端路径引用。请仅使用当前任务已连接的对应服务器工具读取；如果服务器不匹配，请先核对连接。' : context.kind === 'directory'
      ? '这是工作区目录的路径引用。请使用当前工作区的文件工具按需查看目录与文件。'
      : '这是工作区文件的路径引用。请使用当前工作区的文件工具按需读取原文件。')
  }
  const data = new TextEncoder().encode(`${sections.join('\n\n')}\n`)
  const name = contextTransportName(context.path)
  return { id: nextId(), name: presentation.label, size: data.byteLength, isImage: false, context,
    attachment: { kind: 'file', data, name } }
}

/** Exact selections remain distinct when the same lines contain changed text. */
export function workspaceContextKey(reference: WorkspaceContextReference): string {
  const context = normalizedWorkspaceContext(reference)
  const path = context.kind === 'directory' && !/^(?:[\\/]|[a-z]:[\\/])$/iu.test(context.path)
    ? context.path.replace(/[\\/]+$/u, '') : context.path
  return JSON.stringify([context.kind, path, context.startLine ?? null, context.endLine ?? null, context.text ?? null, ...(context.server ? [context.server.id] : [])])
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => { reject(reader.error ?? new Error('read failed')) }
    reader.readAsDataURL(file)
  })
}

export async function toComposerAttachment(file: File): Promise<ComposerAttachment> {
  const mediaType = imageMediaTypes[file.type]
  const name = file.name || 'attachment'
  if (mediaType) {
    const data = await readAsDataUrl(file)
    return {
      id: nextId(),
      name,
      size: file.size,
      isImage: true,
      previewUrl: URL.createObjectURL(file),
      attachment: { kind: 'image', mediaType, data, name },
    }
  }
  const buffer = await file.arrayBuffer()
  return {
    id: nextId(),
    name,
    size: file.size,
    isImage: false,
    attachment: { kind: 'file', data: new Uint8Array(buffer), name },
  }
}

export function releaseComposerAttachment(attachment: ComposerAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
