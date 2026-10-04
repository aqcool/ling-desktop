import type { LingTimelineItem } from '../runtime/contract.js'

// Runtime snapshots may recreate unchanged JSON records. Compare their contents,
// including attachments and execution logs, before re-rendering a message.
function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalValue(a[key], b[key]))
}

export function sameTimelineItem(left: LingTimelineItem, right: LingTimelineItem): boolean {
  return equalValue(left, right)
}

/** All other props (especially action callbacks and live/disabled flags) remain significant. */
export function sameTimelineProps<T extends { readonly item: LingTimelineItem }>(left: T, right: T): boolean {
  const keys = Object.keys(left) as (keyof T)[]
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && (key === 'item'
    ? sameTimelineItem(left.item, right.item)
    : Object.is(left[key], right[key])))
}
