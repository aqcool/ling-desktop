import type { LingChangedFile, LingTaskChanges, LingTimelineItem } from '../runtime/contract.js'
import type { LingPresentedFile } from '../runtime/reply-features.js'

function fileKey(path: string, workspacePath?: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^(?:\.\/)+/, '')
  const absolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
  const rooted = workspacePath && !absolute ? `${fileKey(workspacePath)}/${normalized}` : normalized
  const parts: string[] = []
  for (const part of rooted.replace(/\/+/g, '/').split('/')) {
    if (part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..' && parts.at(-1) !== '') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

export function deliveryForChangedFile(file: LingChangedFile, deliveries: readonly LingPresentedFile[], workspacePath?: string): LingPresentedFile | undefined {
  const paths = new Set([fileKey(file.path, workspacePath), fileKey(file.display, workspacePath)])
  return deliveries.find(delivery => paths.has(fileKey(delivery.path, workspacePath)))
}

/** One file has one conversation entry when the same turn also offers a diff. */
export function withoutReviewedDeliveries(items: readonly LingTimelineItem[], change?: LingTaskChanges): readonly LingTimelineItem[] {
  if (!change?.files.length) return items
  const reviewed = new Set(change.files.flatMap(file => [fileKey(file.path, change.workspacePath), fileKey(file.display, change.workspacePath)]))
  return items.flatMap(item => {
    if (item.taskId !== change.taskId || item.turn !== change.turn || !item.presentedFiles?.length) return [item]
    const files = item.presentedFiles.filter(file => !reviewed.has(fileKey(file.path, change.workspacePath)))
    if (files.length === item.presentedFiles.length) return [item]
    if (!files.length && !item.text && !item.detail && !item.title && !item.attachments?.length && !item.compaction && !item.execution) return []
    return [{ ...item, presentedFiles: files }]
  })
}
