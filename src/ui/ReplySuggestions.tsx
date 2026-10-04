import { useEffect, useState } from 'react'
import { Button } from '@heroui/react/button'
import type { LingTimelineItem } from '../runtime/contract.js'
import type { LingReplyFeatures } from '../runtime/reply-features.js'
import { tw } from './tailwind.js'

const caches = new WeakMap<LingReplyFeatures, Map<string, readonly string[]>>()
export function suggestionReply(items: readonly LingTimelineItem[], running: boolean): LingTimelineItem | undefined {
  if (running) return
  const user = items.findLastIndex(item => item.kind === 'user-message')
  const reply = items.findLast(item => item.kind === 'assistant-message')
  if (user < 0 || !reply || reply.seq === undefined || !reply.turnComplete || reply.status !== 'completed' || reply.streaming || !reply.text.trim()) return
  const at = items.indexOf(reply)
  return at > user && !items.slice(at + 1).some(item => item.status === 'failed' || item.status === 'interrupted') ? reply : undefined
}

export function ReplySuggestions({ reply, service, onChoose }: { reply: LingTimelineItem; service: LingReplyFeatures; onChoose: (text: string) => void }) {
  const key = `${reply.taskId}:${reply.seq}`
  const [state, setState] = useState<{ key: string; values: readonly string[] }>()
  useEffect(() => {
    let cache = caches.get(service)
    if (!cache) { cache = new Map(); caches.set(service, cache) }
    const saved = cache.get(key)
    if (saved) { setState({ key, values: saved }); return }
    const abort = new AbortController()
    // A small delay lets immediate typing or navigation cancel before spending a request.
    const timer = setTimeout(() => { void service.suggestions(reply.taskId, reply.seq!, abort.signal).then(result => {
      if (abort.signal.aborted) return
      const values = result.ok ? result.value : []
      cache.set(key, values)
      if (cache.size > 128) cache.delete(cache.keys().next().value!)
      setState({ key, values })
    }).catch(() => { if (!abort.signal.aborted) { cache.set(key, []); setState({ key, values: [] }) } }) }, 500)
    return () => { clearTimeout(timer); abort.abort() }
  }, [key, reply.taskId, reply.seq, service])
  if (state?.key !== key || !state.values.length) return null
  return <nav aria-label="后续提问建议" data-copy-ignore className={tw('flex min-w-0 flex-wrap gap-1.5 px-4')}>
    {state.values.map(text => <Button key={text} size="sm" variant="outline" className={tw('h-auto min-h-7 max-w-full justify-start rounded-lg px-2.5 py-1 text-left text-xs font-normal whitespace-normal text-[var(--text-secondary)]')} onPress={() => onChoose(text)}>{text}</Button>)}
  </nav>
}
