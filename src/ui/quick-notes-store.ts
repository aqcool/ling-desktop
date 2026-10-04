/** Local notes are independent records, so two app windows cannot overwrite unrelated notes. */
export const taskNotesEvent = 'ling:task-notes-changed'
export const openTaskNotesEvent = 'ling:open-task-notes'
export interface ReplyAnnotationSource { messageId: string; quote: string }
export interface NoteOrigin { taskId: string; title?: string; workspace?: string }
export interface NoteImage { id: string; name: string; type: string; size: number }
export interface TaskNote { id: string; text: string; updatedAt: string; source?: ReplyAnnotationSource }
export interface QuickNote extends TaskNote { createdAt: string; origin?: NoteOrigin; images: NoteImage[]; archived: boolean }
export interface NoteDraft { id?: string; expectedUpdatedAt?: string; text: string; images: NoteImage[]; origin?: NoteOrigin; source?: ReplyAnnotationSource }
const prefix = 'ling.quick-note.v2:'
const legacyPrefix = 'ling.task-notes.v1:'
const originPrefix = 'ling.quick-note-origin.v1:'
export const noteDraftKey = 'ling.quick-note-draft.v1'
const changed = (taskId?: string) => window.dispatchEvent(new CustomEvent(taskNotesEvent, { detail: { taskId } }))
const keys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(Boolean)
const validOrigin = (origin: NoteOrigin) => !!origin && typeof origin.taskId === 'string' && origin.taskId.length > 0 && origin.taskId.length <= 256 && (origin.title === undefined || typeof origin.title === 'string') && (origin.workspace === undefined || typeof origin.workspace === 'string')
const validImages = (images: NoteImage[]) => Array.isArray(images) && images.length <= 6 && images.every(image => image && typeof image.id === 'string' && typeof image.name === 'string' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.type) && Number.isFinite(image.size) && image.size > 0 && image.size <= 5 * 1024 * 1024)
function parseStored(raw: string, message = '速记数据无法读取，已保留原始内容。'): unknown {
  try { return JSON.parse(raw) } catch { throw new Error(message) }
}
export function parseTaskNotes(raw: string | null): TaskNote[] {
  if (!raw) return []
  const value = parseStored(raw)
  if (!Array.isArray(value) || value.some(note => !note || typeof note.id !== 'string' || typeof note.text !== 'string' || typeof note.updatedAt !== 'string' || (note.source !== undefined && (!note.source || typeof note.source.messageId !== 'string' || typeof note.source.quote !== 'string')))) throw new Error('速记数据无法读取，已保留原始内容。')
  return value
}
function parseNote(raw: string): QuickNote {
  const value = parseStored(raw) as QuickNote
  parseTaskNotes(JSON.stringify([value]))
  if (!value.id || typeof value.createdAt !== 'string' || typeof value.archived !== 'boolean' || !validImages(value.images) || (value.origin && !validOrigin(value.origin))) throw new Error('速记数据无法读取，已保留原始内容。')
  return value
}
export function registerNoteOrigin(origin: NoteOrigin): void {
  if (!validOrigin(origin)) return
  const key = originPrefix + encodeURIComponent(origin.taskId)
  const value = JSON.stringify(origin)
  if (localStorage.getItem(key) !== value) localStorage.setItem(key, value)
}
export function noteOrigin(taskId: string): NoteOrigin {
  try { return readOrigin(taskId) } catch { return { taskId } }
}
function readOrigin(taskId: string): NoteOrigin {
  const raw = localStorage.getItem(originPrefix + encodeURIComponent(taskId))
  const origin = raw ? parseStored(raw) as NoteOrigin : { taskId }
  if (!validOrigin(origin)) throw new Error('速记来源无法读取，已保留原始内容。')
  return origin
}
export function readQuickNote(id: string): QuickNote | undefined {
  const raw = localStorage.getItem(prefix + id)
  return raw ? parseNote(raw) : readQuickNotes().find(note => note.id === id)
}
export function readQuickNotes(): QuickNote[] {
  return readQuickNotesSnapshot().notes
}
export function readQuickNotesSnapshot(): { notes: QuickNote[]; unreadableKeys: string[] } {
  const notes = new Map<string, QuickNote>()
  const unreadableKeys = new Set<string>()
  const storedKeys = keys()
  const originFor = (taskId: string): NoteOrigin => {
    try { return readOrigin(taskId) } catch { unreadableKeys.add(originPrefix + encodeURIComponent(taskId)); return { taskId } }
  }
  // Keep old text notes readable; migration happens only when that task is edited.
  for (const key of storedKeys.filter(key => key.startsWith(legacyPrefix))) {
    try {
      const origin = originFor(decodeURIComponent(key.slice(legacyPrefix.length)))
      for (const note of parseTaskNotes(localStorage.getItem(key))) notes.set(note.id, { ...note, origin, createdAt: note.updatedAt, archived: false, images: [] })
    } catch { unreadableKeys.add(key) }
  }
  for (const key of storedKeys.filter(key => key.startsWith(prefix)).reverse()) {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) continue
      const note = parseNote(raw)
      if (note.origin) note.origin = { ...note.origin, ...originFor(note.origin.taskId) }
      notes.set(note.id, note)
    } catch { unreadableKeys.add(key) }
  }
  return { notes: [...notes.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), unreadableKeys: [...unreadableKeys] }
}
export function readTaskNotes(taskId: string): QuickNote[] {
  return readQuickNotes().filter(note => note.origin?.taskId === taskId)
}
function migrateTask(taskId?: string): void {
  if (!taskId) return
  const key = legacyPrefix + encodeURIComponent(taskId)
  const raw = localStorage.getItem(key)
  if (!raw) return
  for (const note of parseTaskNotes(raw)) {
    if (!localStorage.getItem(prefix + note.id)) localStorage.setItem(prefix + note.id, JSON.stringify({ ...note, origin: noteOrigin(taskId), createdAt: note.updatedAt, archived: false, images: [] }))
  }
  // Remove only after every record was written; a failed migration retains the original.
  localStorage.removeItem(key)
}
export function saveQuickNote(draft: NoteDraft): string {
  if (!draft.text.trim() && !draft.images.length) throw new Error('请填写速记内容或添加图片。')
  if (draft.text.length > 20000) throw new Error('单条速记不能超过 20,000 字。')
  if (!validImages(draft.images)) throw new Error('每条速记最多添加 6 张图片，每张不超过 5 MB。')
  if (draft.origin && !validOrigin(draft.origin)) throw new Error('会话来源无效。')
  if (draft.source && (!draft.source.messageId || !draft.source.quote.trim() || draft.source.quote.length > 20000)) throw new Error('批注原文为空或超过 20,000 字。')
  migrateTask(draft.origin?.taskId)
  const id = draft.id ?? crypto.randomUUID()
  const raw = localStorage.getItem(prefix + id)
  const previous = raw ? parseNote(raw) : undefined
  if (draft.id && !previous) throw new Error('这条速记已被删除，请重新保存。')
  if (draft.expectedUpdatedAt && previous?.updatedAt !== draft.expectedUpdatedAt) throw new Error('这条速记已在其他窗口更新，请取消编辑后重新打开。草稿已保留。')
  const now = new Date(Math.max(Date.now(), previous ? (Date.parse(previous.updatedAt) || 0) + 1 : 0)).toISOString()
  const note: QuickNote = { id, text: draft.text.trim(), images: draft.images, createdAt: previous?.createdAt ?? now, updatedAt: now, archived: previous?.archived ?? false, ...(draft.origin ? { origin: draft.origin } : {}), ...(draft.source ? { source: draft.source } : {}) }
  localStorage.setItem(prefix + id, JSON.stringify(note)); changed(note.origin?.taskId)
  if (previous) void discardNoteImages(previous.images)
  return id
}
export function saveTaskNote(taskId: string, text: string, id?: string, source?: ReplyAnnotationSource): string {
  if (!taskId || !text.trim()) throw new Error('请填写速记内容。')
  const previous = id ? readTaskNotes(taskId).find(note => note.id === id) : undefined
  return saveQuickNote({ id, text, origin: previous?.origin ?? noteOrigin(taskId), source: source ?? previous?.source, images: previous?.images ?? [] })
}
export function archiveQuickNote(id: string, archived: boolean): void {
  const previous = readQuickNotes().find(note => note.id === id)
  if (!previous) throw new Error('这条速记已被删除。')
  migrateTask(previous.origin?.taskId)
  localStorage.setItem(prefix + id, JSON.stringify({ ...previous, archived, updatedAt: new Date().toISOString() })); changed(previous.origin?.taskId)
}
export function removeQuickNote(id: string): void {
  const note = readQuickNotes().find(note => note.id === id)
  if (!note) return
  migrateTask(note.origin?.taskId)
  localStorage.removeItem(prefix + id); changed(note.origin?.taskId)
  void discardNoteImages(note.images)
}
export function removeTaskNote(taskId: string, id: string): void {
  if (readTaskNotes(taskId).some(note => note.id === id)) removeQuickNote(id)
}
export function taskNoteText(note: Pick<TaskNote, 'text' | 'source'>): string {
  return note.source ? `${note.source.quote.split('\n').map(line => `> ${line}`).join('\n')}\n\n批注：${note.text}` : note.text
}
export function openTaskNotes(taskId?: string) { window.dispatchEvent(new CustomEvent(openTaskNotesEvent, { detail: { taskId } })) }
export function readNoteDraft(): NoteDraft | undefined {
  const raw = localStorage.getItem(noteDraftKey)
  if (!raw) return
  const draft = parseStored(raw, '速记草稿无法读取，原始内容已保留。') as NoteDraft
  if (!draft || typeof draft.text !== 'string' || !validImages(draft.images) || (draft.id !== undefined && typeof draft.id !== 'string') || (draft.origin && !validOrigin(draft.origin))) throw new Error('速记草稿无法读取，原始内容已保留。')
  return draft
}
export function writeNoteDraft(draft?: NoteDraft): void {
  const previous = readNoteDraft()
  if (draft) localStorage.setItem(noteDraftKey, JSON.stringify(draft)); else localStorage.removeItem(noteDraftKey)
  if (previous) void discardNoteImages(previous.images)
}
export function groupQuickNotes(notes: QuickNote[], range: 'current' | 'archived' | 'all', group: 'time' | 'source', query: string): { key: string; label: string; notes: QuickNote[] }[] {
  const groups = new Map<string, { key: string; label: string; notes: QuickNote[] }>()
  for (const note of notes) {
    if ((range === 'current' && note.archived) || (range === 'archived' && !note.archived)) continue
    if (query && ![note.text, note.source?.quote, note.origin?.title, note.origin?.workspace, ...note.images.map(image => image.name)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue
    const date = new Date(note.createdAt)
    const key = group === 'source' ? note.origin?.taskId ?? 'independent' : Number.isNaN(date.getTime()) ? 'unknown' : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    const label = group === 'source' ? note.origin?.title ?? (note.origin ? '会话速记' : '独立速记') : Number.isNaN(date.getTime()) ? '更早' : date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric' })
    if (!groups.has(key)) groups.set(key, { key, label, notes: [] })
    groups.get(key)!.notes.push(note)
  }
  return [...groups.values()]
}

// Images are local Blobs in IndexedDB, never uploaded or placed in text-storage quotas.
let database: Promise<IDBDatabase> | undefined
function imageDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('ling-quick-notes', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('images')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(new Error('无法打开本地图片存储。')) }
  })
  return database
}
export async function saveNoteImage(file: File): Promise<NoteImage> {
  const image: NoteImage = { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size }
  if (!validImages([image])) throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片，每张不超过 5 MB。')
  const db = await imageDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('images', 'readwrite')
    transaction.objectStore('images').put(file, image.id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(new Error('图片保存失败，请检查本地存储空间。'))
  })
  return image
}
export async function readNoteImage(id: string): Promise<Blob> {
  const db = await imageDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').get(id)
    request.onsuccess = () => request.result instanceof Blob ? resolve(request.result) : reject(new Error('本地图片不存在。'))
    request.onerror = () => reject(new Error('图片读取失败。'))
  })
}

/** Remove only assets explicitly removed from a note/draft, preserving every remaining reference. */
export async function discardNoteImages(images: NoteImage[]): Promise<void> {
  if (!images.length || typeof indexedDB === 'undefined') return
  try {
    const db = await imageDatabase()
    const snapshot = readQuickNotesSnapshot()
    // Unreadable records may still own images. Do not infer that those assets are unused.
    if (snapshot.unreadableKeys.length) return
    const retained = new Set([...snapshot.notes.flatMap(note => note.images), ...(readNoteDraft()?.images ?? [])].map(image => image.id))
    const unused = images.filter(image => !retained.has(image.id))
    if (!unused.length) return
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('images', 'readwrite')
      for (const image of unused) transaction.objectStore('images').delete(image.id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => reject(transaction.error)
    })
  } catch { /* Never delete assets when a note or draft cannot be read. */ }
}
