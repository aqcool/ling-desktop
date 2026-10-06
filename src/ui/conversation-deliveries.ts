import type { LingChangedFile, LingTaskChanges, LingTimelineItem } from '../runtime/contract.js'
import type { LingPresentedFile } from '../runtime/reply-features.js'

function fileKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^(?:\.\/)+/, '')
}

export function deliveryForChangedFile(file: LingChangedFile, deliveries: readonly LingPresentedFile[]): LingPresentedFile | undefined {
  const paths = new Set([fileKey(file.path), fileKey(file.display)])
  return deliveries.find(delivery => paths.has(fileKey(delivery.path)))
}

/** One file has one conversation entry when the same turn also offers a diff. */
export function withoutReviewedDeliveries(items: readonly LingTimelineItem[], change?: LingTaskChanges): readonly LingTimelineItem[] {
  if (!change?.files.length) return items
  const reviewed = new Set(change.files.flatMap(file => [fileKey(file.path), fileKey(file.display)]))
  return items.flatMap(item => {
    if (item.taskId !== change.taskId || item.turn !== change.turn || !item.presentedFiles?.length) return [item]
    const files = item.presentedFiles.filter(file => !reviewed.has(fileKey(file.path)))
    if (files.length === item.presentedFiles.length) return [item]
    if (!files.length && !item.text && !item.detail && !item.title && !item.attachments?.length && !item.compaction && !item.execution) return []
    return [{ ...item, presentedFiles: files }]
  })
}
