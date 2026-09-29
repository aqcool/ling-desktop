import type { LingImageMediaType, LingPromptAttachment } from '../runtime/contract.js'

export interface ComposerAttachment {
  readonly id: string
  readonly attachment: LingPromptAttachment
  readonly name: string
  readonly size: number
  readonly isImage: boolean
  readonly previewUrl?: string
  readonly quote?: string
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
