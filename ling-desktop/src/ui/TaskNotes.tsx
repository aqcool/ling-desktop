import { useEffect, useState, type ChangeEvent } from 'react'
import { TextArea } from '@heroui/react/textarea'
import { CompactButton as Button } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export const taskNotesEvent = 'ling:task-notes-changed'
export const openTaskNotesEvent = 'ling:open-task-notes'
export interface TaskNote { id: string; text: string; updatedAt: string }
const storageKey = (taskId: string) => `ling.task-notes.v1:${encodeURIComponent(taskId)}`
export function parseTaskNotes(raw: string | null): TaskNote[] {
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.some(note => !note || typeof note.id !== 'string' || typeof note.text !== 'string' || typeof note.updatedAt !== 'string')) throw new Error('速记数据无法读取，已保留原始内容。')
  return value
}
export function readTaskNotes(taskId: string): TaskNote[] { return parseTaskNotes(localStorage.getItem(storageKey(taskId))) }
export function saveTaskNote(taskId: string, text: string, id?: string): void {
  if (!taskId || !text.trim()) throw new Error('请填写速记内容。')
  if (text.length > 20000) throw new Error('单条速记不能超过 20,000 字。')
  const notes = readTaskNotes(taskId)
  if (!id && notes.length >= 200) throw new Error('当前任务的速记已达到 200 条。')
  const note: TaskNote = { id: id ?? crypto.randomUUID(), text: text.trim(), updatedAt: new Date().toISOString() }
  const index = notes.findIndex(item => item.id === note.id)
  if (id && index < 0) throw new Error('这条速记已被删除，请重新保存。')
  if (index < 0) notes.unshift(note); else notes[index] = note
  localStorage.setItem(storageKey(taskId), JSON.stringify(notes))
  window.dispatchEvent(new CustomEvent(taskNotesEvent, { detail: { taskId } }))
}
export function removeTaskNote(taskId: string, id: string): void {
  localStorage.setItem(storageKey(taskId), JSON.stringify(readTaskNotes(taskId).filter(note => note.id !== id)))
  window.dispatchEvent(new CustomEvent(taskNotesEvent, { detail: { taskId } }))
}
export function openTaskNotes(taskId: string) { window.dispatchEvent(new CustomEvent(openTaskNotesEvent, { detail: { taskId } })) }

export function TaskNotes({ taskId, onAttach }: { taskId: string; onAttach: (text: string) => void }) {
  const [notes, setNotes] = useState<TaskNote[]>([])
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string>()
  const [error, setError] = useState<string>()
  const [removeId, setRemoveId] = useState<string>()
  useEffect(() => {
    const refresh = () => { try { setNotes(readTaskNotes(taskId)); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取速记。') } }
    refresh(); window.addEventListener(taskNotesEvent, refresh); window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(taskNotesEvent, refresh); window.removeEventListener('storage', refresh) }
  }, [taskId])
  const act = (operation: () => void) => { try { operation(); setError(undefined); return true } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存速记，请检查本地存储。'); return false } }
  return <section aria-label="任务速记" className={tw('flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4')}>
    <div className={tw('flex items-center justify-between')}><h2 className={tw('m-0 text-sm font-medium')}>速记</h2><span className={tw('text-xs text-[var(--text-tertiary)]')}>{notes.length} 条</span></div>
    <TextArea aria-label="速记内容" className={tw('min-h-28 w-full shrink-0 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-3 text-xs')} placeholder="记录当前任务的想法…" value={text} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)} />
    <div className={tw('flex justify-end gap-2')}>{editing ? <Button variant="ghost" onPress={() => { setEditing(undefined); setText('') }}>取消</Button> : null}<Button isDisabled={!text.trim()} onPress={() => { if (act(() => saveTaskNote(taskId, text, editing))) { setText(''); setEditing(undefined) } }}>保存</Button></div>
    {error ? <p role="alert" className={tw('m-0 text-xs text-[var(--danger)]')}>{error}</p> : null}
    {notes.map(note => <article key={note.id} className={tw('rounded-xl border border-[var(--panel-border)] p-3')}>
      <p className={tw('m-0 whitespace-pre-wrap break-words text-xs leading-6')}>{note.text}</p>
      <div className={tw('mt-2 flex items-center justify-end gap-1')}>
        <Button variant="ghost" isIconOnly aria-label="添加速记到输入框" onPress={() => onAttach(note.text)}><Icon name="paperclip" size={14} /></Button>
        <Button variant="ghost" isIconOnly aria-label="编辑速记" onPress={() => { setEditing(note.id); setText(note.text) }}><Icon name="edit" size={14} /></Button>
        <Button variant="ghost" isIconOnly aria-label="删除速记" onPress={() => setRemoveId(note.id)}><Icon name="trash" size={14} /></Button>
      </div>
      {removeId === note.id ? <div className={tw('mt-2 flex items-center justify-end gap-2 text-xs')}><span>删除这条速记？</span><Button variant="ghost" onPress={() => setRemoveId(undefined)}>取消</Button><Button variant="danger" onPress={() => { if (act(() => removeTaskNote(taskId, note.id))) { setRemoveId(undefined); if (editing === note.id) { setEditing(undefined); setText('') } } }}>删除</Button></div> : null}
    </article>)}
    {!notes.length ? <p className={tw('text-center text-xs text-[var(--text-tertiary)]')}>暂无速记</p> : null}
  </section>
}
