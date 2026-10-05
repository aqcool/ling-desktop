import { unzipSync, strFromU8 } from 'fflate'

export const OFFICE_MAX_BYTES = 16 * 1024 * 1024
const EXPANDED_MAX_BYTES = 64 * 1024 * 1024
export type OfficeArchive = Record<string, Uint8Array>

/** Bound allocations before inflation, including ZIPs with small compressed payloads. */
export function openOfficeArchive(bytes: Uint8Array): OfficeArchive {
  if (bytes.byteLength > OFFICE_MAX_BYTES) throw new Error('文件超过 16 MB，无法预览。')
  let expanded = 0, entries = 0
  try {
    const archive = unzipSync(bytes, { filter(entry) {
      expanded += entry.originalSize
      entries += 1
      if (expanded > EXPANDED_MAX_BYTES || entry.originalSize > OFFICE_MAX_BYTES || entries > 3000) throw new Error('文档解压后的内容过大，无法预览。')
      return !entry.name.endsWith('/')
    } })
    if (!archive['[Content_Types].xml']) throw new Error('不是有效的 Office 文档。')
    return archive
  } catch (error) {
    if (error instanceof Error && /过大|Office/.test(error.message)) throw error
    throw new Error('文档已损坏或已加密，无法预览。')
  }
}

export function officeXml(archive: OfficeArchive, path: string, optional = false): Document | undefined {
  const bytes = archive[path]
  if (!bytes) { if (optional) return; throw new Error('文档缺少必要内容，无法预览。') }
  const source = strFromU8(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('文档包含不支持的 XML 声明。')
  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.getElementsByTagName('parsererror').length) throw new Error('文档内容无效，无法预览。')
  return xml
}
export function children(node: Element, name: string): Element[] { return Array.from(node.children).filter(child => child.localName === name) }
export function descendants(node: Document | Element, name: string): Element[] { return Array.from(node.getElementsByTagNameNS('*', name)) }
export function child(node: Element | undefined, name: string): Element | undefined { return node ? children(node, name)[0] : undefined }
export function attr(node: Element | undefined, name: string): string | undefined { return node ? Array.from(node.attributes).find(value => value.localName === name)?.value : undefined }
export function numeric(value: string | undefined, fallback = 0): number { const number = value === undefined ? NaN : Number(value); return Number.isFinite(number) ? number : fallback }
export function enabled(node: Element | undefined): boolean { return !!node && !['0', 'false', 'off'].includes(attr(node, 'val') ?? '1') }
export function rgb(value: string | undefined): string | undefined { return value && /^[a-f\d]{6}$/i.test(value) ? `#${value}` : undefined }

/** Resolve package-relative relationships only; external resources are never fetched. */
export function relations(archive: OfficeArchive, part: string): Map<string, string> {
  const slash = part.lastIndexOf('/'), directory = part.slice(0, slash + 1)
  const doc = officeXml(archive, `${directory}_rels/${part.slice(slash + 1)}.rels`, true)
  const result = new Map<string, string>()
  if (!doc) return result
  for (const relation of descendants(doc, 'Relationship')) {
    const id = attr(relation, 'Id'), target = attr(relation, 'Target')
    if (!id || !target || attr(relation, 'TargetMode') === 'External' || /^[a-z]+:/i.test(target)) continue
    const parts: string[] = []
    for (const segment of (target.startsWith('/') ? target.slice(1) : directory + target).split('/')) {
      if (segment === '..') parts.pop()
      else if (segment !== '.' && segment) parts.push(segment)
    }
    result.set(id, parts.join('/'))
  }
  return result
}
export function imageSource(archive: OfficeArchive, path: string | undefined): string | undefined {
  if (!path || !archive[path]) return
  const media = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[path.split('.').at(-1)?.toLowerCase() ?? '']
  if (!media) return
  const bytes = archive[path]!
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:${media};base64,${btoa(binary)}`
}
