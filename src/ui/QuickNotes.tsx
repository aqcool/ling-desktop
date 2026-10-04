import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { TextArea } from '@heroui/react/textarea'
import { CompactButton } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu.js'
import { Markdown } from './Markdown.js'
import { tw } from './tailwind.js'
import { applyAppearance, useAppearance } from '../theme.js'
import { nativeQuickNotes, type NoteWindowAction } from './quick-notes-native.js'
import { archiveQuickNote, discardNoteImages, groupQuickNotes, readNoteDraft, readNoteImage, readQuickNote, readQuickNotesSnapshot, removeQuickNote, saveNoteImage, saveQuickNote, taskNotesEvent, writeNoteDraft, type NoteDraft, type NoteImage, type NoteOrigin, type QuickNote } from './quick-notes-store.js'

const iconButton = '[-webkit-app-region:no-drag] grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]'
function NotePicture({ image, onOpen }: { image: NoteImage; onOpen?: (image: NoteImage) => void }) {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true; let objectUrl: string | undefined
    setUrl(undefined); setError(false)
    void readNoteImage(image.id).then(blob => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [image.id])
  if (!url) return <span className={tw('text-xs text-[var(--text-tertiary)]')}>{error ? `无法读取 ${image.name}` : '正在读取图片…'}</span>
  const picture = <img src={url} alt={image.name} className={tw('block max-h-80 w-full rounded-xl object-contain')} />
  return onOpen ? <button type="button" aria-label={`查看图片 ${image.name}`} className={tw('block w-full cursor-zoom-in border-0 bg-transparent p-0')} onClick={() => onOpen(image)}>{picture}</button> : picture
}

/** One compact local notebook, shared across app windows. Closing it preserves the editor draft. */
export function QuickNotes({ initialOrigin, onAction, onClose, native = false }: {
  initialOrigin?: NoteOrigin; onAction: (action: NoteWindowAction) => Promise<void>; onClose?: () => void; native?: boolean
}) {
  const appearance = useAppearance()
  useEffect(() => { if (native) applyAppearance(appearance, appearance.resolved) }, [appearance.mode, appearance.palette, appearance.resolved, appearance.fontStyle, appearance.contentWidth, appearance.fileIcons, appearance.glass, native])
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [error, setError] = useState<string>()
  const [unreadableCount, setUnreadableCount] = useState(0)
  const [draft, setDraft] = useState<NoteDraft>()
  const [origin, setOrigin] = useState(initialOrigin)
  const [draftUnreadable, setDraftUnreadable] = useState(false)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<'current' | 'archived' | 'all'>('current')
  const [group, setGroup] = useState<'time' | 'source'>('time')
  const [removeId, setRemoveId] = useState<string>()
  const [picture, setPicture] = useState<NoteImage>()
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const draftRef = useRef(draft); draftRef.current = draft
  const message = (cause: unknown) => setError(cause instanceof Error ? cause.message : '速记操作失败，请重试。')
  const act = (operation: () => void) => { try { operation(); setError(undefined); return true } catch (cause) { message(cause); return false } }
  useEffect(() => {
    const refresh = () => {
      try {
        const snapshot = readQuickNotesSnapshot()
        setNotes(snapshot.notes); setUnreadableCount(snapshot.unreadableKeys.length)
      } catch (cause) { message(cause) }
    }
    refresh()
    try { setDraft(readNoteDraft()) } catch (cause) { setDraftUnreadable(true); message(cause) }
    window.addEventListener(taskNotesEvent, refresh); window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(taskNotesEvent, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  useEffect(() => { setOrigin(initialOrigin) }, [initialOrigin])
  useEffect(() => {
    if (!native) return
    const bridge = nativeQuickNotes()
    void bridge?.context().then(setOrigin).catch(message)
    return bridge?.onContext(setOrigin)
  }, [native])
  const changeDraft = (next?: NoteDraft) => {
    // Keep the visible draft even on a quota error; never silently clear unsaved content.
    if (next) { draftRef.current = next; setDraft(next) }
    if (act(() => writeNoteDraft(next)) && !next) { draftRef.current = undefined; setDraft(undefined) }
  }
  const begin = (note?: QuickNote) => {
    if (draftUnreadable) return
    if (draftRef.current) { editor.current?.focus(); setError('请先保存或取消当前草稿。'); return }
    changeDraft(note ? { id: note.id, expectedUpdatedAt: note.updatedAt, text: note.text, images: note.images, origin: note.origin, source: note.source } : { text: '', images: [], origin })
    requestAnimationFrame(() => editor.current?.focus())
  }
  const save = () => {
    const current = draftRef.current
    if (!current) return
    // Clearing a draft is separate from saving: failed saves always keep the editor intact.
    try {
      const id = saveQuickNote(current)
      const saved = readQuickNote(id)!
      // If clearing storage fails, retry edits this saved record instead of duplicating it.
      const next = { ...current, id, expectedUpdatedAt: saved.updatedAt }
      draftRef.current = next; setDraft(next)
      changeDraft(undefined)
    } catch (cause) { message(cause) }
  }
  const addImages = async (files: File[]) => {
    if (!files.length || busy || !draftRef.current) return
    if (draftRef.current.images.length + files.length > 6) { setError('每条速记最多添加 6 张图片。'); return }
    setBusy(true)
    const images: NoteImage[] = []
    try {
      for (const file of files) images.push(await saveNoteImage(file))
      if (draftRef.current) changeDraft({ ...draftRef.current, images: [...draftRef.current.images, ...images] })
    } catch (cause) { void discardNoteImages(images); message(cause) }
    finally { setBusy(false) }
  }
  const send = (action: NoteWindowAction) => { setBusy(true); void onAction(action).then(() => setError(undefined)).catch(message).finally(() => setBusy(false)) }
  const copyImage = async (image: NoteImage) => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前环境不支持复制图片。')
      const bitmap = await createImageBitmap(await readNoteImage(image.id))
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
        const png = await canvas.convertToBlob({ type: 'image/png' })
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      } finally { bitmap.close() }
      setError(undefined)
    } catch (cause) { message(cause) }
  }
  const groups = groupQuickNotes(notes, range, group, query)
  const copy = (note: QuickNote) => { if (!navigator.clipboard) { setError('复制不可用，请重试。'); return } void navigator.clipboard.writeText(note.source ? `${note.source.quote}\n\n批注：${note.text}` : note.text).catch(message) }
  return <section aria-label="速记板" className={tw('relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--surface)] text-[var(--foreground)]')}>
    <header className={tw('flex h-12 shrink-0 items-center justify-end gap-1 px-4 select-none', native && '[-webkit-app-region:drag]', native && document.documentElement.dataset.platform === 'win32' && 'pr-36')}>
      <button type="button" className={tw(iconButton)} aria-label="搜索速记板" aria-expanded={searching} onClick={() => { setSearching(current => !current); setQuery('') }}><Icon name="search" size={18} /></button>
      <Menu triggerAriaLabel="整理速记板" triggerLabel={<Icon name="sliders" size={18} />} triggerClassName={iconButton}>
        <MenuLabel>显示范围</MenuLabel>
        {([['current', '当前'], ['archived', '已归档'], ['all', '全部']] as const).map(([value, label]) => <MenuItem key={value} checked={range === value} onPress={() => setRange(value)}>{label}</MenuItem>)}
        <MenuSeparator /><MenuLabel>分组方式</MenuLabel>
        <MenuItem checked={group === 'source'} onPress={() => setGroup('source')}>任务来源</MenuItem>
        <MenuItem checked={group === 'time'} onPress={() => setGroup('time')}>时间</MenuItem>
      </Menu>
      {onClose ? <button aria-label="关闭速记板" type="button" className={tw(iconButton)} onClick={onClose}><Icon name="close" size={17} /></button> : null}
    </header>
    <div className={tw('shrink-0 px-6 pt-2 pb-5')}>
      <h1 className={tw('m-0 text-2xl font-semibold italic tracking-tight')}><span className={tw("mr-2 [font-family:'Snell_Roundhand','Segoe_Print',cursive] text-[var(--success)]")}>Quick</span> Notes</h1>
      {searching ? <div className={tw('mt-4 flex items-center gap-2 rounded-lg border border-[var(--panel-border)] px-3')}><Icon name="search" size={15} /><input autoFocus aria-label="搜索笔记" placeholder="搜索笔记…" value={query} onChange={event => setQuery(event.target.value)} className={tw('h-9 w-full min-w-0 border-0 bg-transparent text-sm outline-none')} onKeyDown={event => { if (event.key === 'Escape') { setSearching(false); setQuery('') } }} /></div> : null}
    </div>
    {error ? <p role="alert" className={tw('mx-6 mt-0 mb-3 shrink-0 text-xs leading-5 text-[var(--danger)]')}>{error}</p> : null}
    {unreadableCount ? <p role="status" className={tw('mx-6 mt-0 mb-3 shrink-0 text-xs leading-5 text-[var(--text-secondary)]')}>有 {unreadableCount} 条速记数据暂时无法读取，原始内容已保留。</p> : null}
    <div className={tw('min-h-0 flex-1 overflow-y-auto overscroll-contain', !draft && 'pb-20')}>
      {groups.map(section => <section key={section.key} aria-label={section.label}>
        <h2 className={tw('sticky top-0 z-1 m-0 border-b border-[var(--panel-border)] bg-[var(--surface)] px-6 py-3 text-sm font-medium text-[var(--text-secondary)]')}>{section.label}</h2>
        {section.notes.map(note => <article key={note.id} className={tw('group/note grid grid-cols-[18px_minmax(0,1fr)_24px] gap-x-3 px-6 py-5', note.archived && 'opacity-65')}>
          <input aria-label={note.archived ? '取消归档速记' : '归档速记'} title={note.archived ? '取消归档' : '归档'} type="checkbox" checked={note.archived} onChange={event => { act(() => archiveQuickNote(note.id, event.target.checked)) }} className={tw('mt-1 size-4 cursor-pointer accent-[var(--success)]')} />
          <div className={tw('min-w-0 space-y-3')}>
            {note.source ? <blockquote className={tw('m-0 max-h-24 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[var(--panel-border)] pl-3 text-xs leading-5 text-[var(--text-tertiary)]')}>{note.source.quote}</blockquote> : null}
            {note.text ? <Markdown source={note.text} /> : null}
            {note.images.map(image => <NotePicture key={image.id} image={image} onOpen={setPicture} />)}
            {note.origin ? <button type="button" aria-label={`查看来源会话 ${note.origin.title ?? ''}`} title={note.origin.workspace} className={tw('block max-w-full truncate border-0 bg-transparent p-0 text-xs text-[var(--text-tertiary)] hover:text-[var(--foreground)]')} onClick={() => send({ action: 'source', id: note.id })}>{note.origin.title ?? '会话来源'} <span aria-hidden>↗</span></button> : null}
            {removeId === note.id ? <div className={tw('flex flex-wrap items-center justify-end gap-2 text-xs')}><span>删除这条速记？</span><CompactButton variant="ghost" onPress={() => setRemoveId(undefined)}>取消</CompactButton><CompactButton variant="danger" onPress={() => { if (act(() => removeQuickNote(note.id))) setRemoveId(undefined) }}>删除</CompactButton></div> : null}
          </div>
          <Menu triggerAriaLabel="打开速记操作菜单" triggerLabel={<Icon name="more" size={16} />} triggerClassName="size-6 rounded-md hover:bg-[var(--surface-hover)]">
            <MenuItem icon="edit" onPress={() => begin(note)}>编辑</MenuItem>
            {note.text ? <MenuItem icon="copy" onPress={() => copy(note)}>复制文本</MenuItem> : null}
            {note.images.map(image => <MenuItem key={image.id} icon="image" onPress={() => { void copyImage(image) }}>{note.images.length > 1 ? `复制图片：${image.name}` : '复制图片'}</MenuItem>)}
            <MenuItem icon="paperclip" disabled={busy} onPress={() => send({ action: 'attach', id: note.id })}>加入当前任务</MenuItem>
            <MenuItem icon="archive" onPress={() => { act(() => archiveQuickNote(note.id, !note.archived)) }}>{note.archived ? '取消归档' : '归档'}</MenuItem>
            <MenuSeparator /><MenuItem icon="trash" danger onPress={() => setRemoveId(note.id)}>删除</MenuItem>
          </Menu>
        </article>)}
      </section>)}
      {!groups.length ? <div className={tw('px-6 py-12 text-center text-sm leading-6 text-[var(--text-tertiary)]')}>{query ? '没有找到匹配的速记' : range === 'archived' ? '暂无已归档速记' : '记下想法，留待下一步。'}</div> : null}
    </div>
    {draft ? <div className={tw('mx-4 mb-4 mt-2 shrink-0 overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] shadow-[var(--surface-shadow)]')}>
      <TextArea ref={editor} aria-label="速记内容" placeholder="记下点什么…" value={draft.text} maxLength={20000} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => changeDraft({ ...draft, text: event.target.value })} onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addImages(files) } }} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); if (!busy) save() } }} className={tw('h-36 max-h-[30vh] min-h-20 w-full resize-y border-0 bg-transparent p-4 text-sm leading-6 outline-none')} />
      {draft.images.length ? <div className={tw('flex max-h-24 gap-2 overflow-auto px-4 pb-3')}>{draft.images.map(image => <div key={image.id} className={tw('relative w-16 shrink-0')}><NotePicture image={image} /><button type="button" aria-label={`移除图片 ${image.name}`} disabled={busy} className={tw('absolute right-0 top-0 grid size-5 place-items-center rounded-full border border-[var(--panel-border)] bg-[var(--surface)]')} onClick={() => changeDraft({ ...draft, images: draft.images.filter(item => item.id !== image.id) })}><Icon name="close" size={12} /></button></div>)}</div> : null}
      <div className={tw('flex items-center justify-between gap-2 border-t border-dashed border-[var(--panel-border)] px-3 py-3')}>
        <CompactButton variant="ghost" isDisabled={busy} onPress={() => changeDraft(undefined)}>取消</CompactButton>
        <div className={tw('flex items-center gap-2')}><button type="button" aria-label="添加图片" disabled={busy} className={tw(iconButton)} onClick={() => fileInput.current?.click()}><Icon name="image" size={18} /></button><CompactButton className={tw('bg-[var(--success)] text-[var(--success-foreground)]')} isDisabled={busy || (!draft.text.trim() && !draft.images.length)} onPress={save}>{draft.id ? '保存修改' : '添加速记'}</CompactButton></div>
      </div>
    </div> : <button type="button" aria-label="添加速记" disabled={draftUnreadable} onClick={() => begin()} className={tw('absolute bottom-5 right-5 grid size-10 cursor-pointer place-items-center rounded-xl border border-[var(--panel-border)] bg-[var(--success)] text-[var(--success-foreground)] shadow-[var(--surface-shadow)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]')}><Icon name="feather" size={22} /></button>}
    <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void addImages(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    {picture ? <div role="dialog" aria-modal="true" aria-label="速记图片" className={tw('absolute inset-0 z-30 flex flex-col bg-[var(--surface)] p-5')} onKeyDown={event => { if (event.key === 'Escape') setPicture(undefined); if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus() } }}><div className={tw('mb-4 flex items-center justify-between gap-2')}><span className={tw('truncate text-sm')}>{picture.name}</span><button autoFocus aria-label="关闭图片" type="button" className={tw(iconButton)} onClick={() => setPicture(undefined)}><Icon name="close" size={18} /></button></div><div className={tw('min-h-0 flex-1 overflow-auto')}><NotePicture image={picture} /></div></div> : null}
  </section>
}

export function NativeQuickNotesWindow() {
  return <QuickNotes native onAction={async action => {
    const bridge = nativeQuickNotes()
    if (!bridge) throw new Error('速记窗口连接不可用。')
    await bridge.send(action)
  }} />
}
