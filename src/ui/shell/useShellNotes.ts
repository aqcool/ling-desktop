import { useCallback, useEffect, useRef, useState } from 'react'
import { noteOrigin, openTaskNotesEvent, readNoteImage, readQuickNote, registerNoteOrigin, taskNoteText, type NoteOrigin } from '../TaskNotes.js'
import { useBehavior } from '../behavior-preferences.js'
import { nativeQuickNotes, type NoteWindowAction } from '../quick-notes-native.js'
import type { LingShellProps } from './types.js'

export function useShellNotes(props: Pick<
  LingShellProps,
  'onAddFiles'
  | 'onPromptChange'
  | 'onSelectTask'
  | 'onWorkspaceOpen'
  | 'prompt'
  | 'screen'
  | 'selectedTask'
  | 'tasks'
  | 'workspaces'
>) {
  const { tasks, workspaces, screen, selectedTask, prompt, onAddFiles, onPromptChange } = props
  const behavior = useBehavior()
  const notePromptRef = useRef(prompt); notePromptRef.current = prompt
  const [notesFloating, setNotesFloating] = useState(false)
  const [notesOrigin, setNotesOrigin] = useState<NoteOrigin>()
  const [notesError, setNotesError] = useState<string>()
  useEffect(() => {
    try {
      for (const task of tasks) registerNoteOrigin({ taskId: task.taskId, title: task.title, workspace: workspaces.find(workspace => workspace.workspaceId === task.workspaceId)?.label })
    } catch { /* Reading notes will surface a storage error without disrupting the task. */ }
  }, [tasks, workspaces])
  const requestNotes = useCallback((taskId?: string) => {
    if (!behavior.quickNotes && !behavior.replyAnnotations) return
    try {
      const origin = taskId ? noteOrigin(taskId) : undefined
      const bridge = nativeQuickNotes()
      setNotesError(undefined)
      if (bridge) void bridge.open(origin).catch(cause => setNotesError(cause instanceof Error ? cause.message : '无法打开速记板。'))
      else { setNotesOrigin(origin); setNotesFloating(true) }
    } catch (cause) { setNotesError(cause instanceof Error ? cause.message : '无法打开速记板。') }
  }, [behavior.quickNotes, behavior.replyAnnotations])
  const handleNoteAction = useCallback(async ({ action, id }: NoteWindowAction) => {
    const note = readQuickNote(id)
    if (!note) throw new Error('这条速记已被删除。')
    if (action === 'source') {
      if (!note.origin || !tasks.some(task => task.taskId === note.origin?.taskId)) throw new Error('来源会话已不可用，速记内容仍保留。')
      props.onWorkspaceOpen(); props.onSelectTask(note.origin.taskId); return
    }
    const files = await Promise.all(note.images.map(async image => new File([await readNoteImage(image.id)], image.name, { type: image.type })))
    if (files.length) onAddFiles(files)
    const text = taskNoteText(note)
    if (text) onPromptChange([notePromptRef.current, text].filter(Boolean).join('\n\n'))
    props.onWorkspaceOpen()
  }, [tasks, prompt, onAddFiles, onPromptChange, props.onWorkspaceOpen, props.onSelectTask])
  useEffect(() => {
    const notes = (event: Event) => requestNotes((event as CustomEvent<{ taskId?: string }>).detail?.taskId)
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === '9' && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); requestNotes(screen === 'workspace' ? selectedTask?.taskId : undefined)
      }
    }
    window.addEventListener(openTaskNotesEvent, notes); window.addEventListener('keydown', key)
    return () => { window.removeEventListener(openTaskNotesEvent, notes); window.removeEventListener('keydown', key) }
  }, [requestNotes, selectedTask?.taskId, screen])
  useEffect(() => nativeQuickNotes()?.onAction(action => {
    void handleNoteAction(action).catch(cause => setNotesError(cause instanceof Error ? cause.message : '速记操作失败。'))
  }), [handleNoteAction])

  return { notesFloating, setNotesFloating, notesOrigin, notesError, requestNotes, handleNoteAction }
}
