import { useState } from 'react'
import { Modal } from '@heroui/react/modal'
import { TextField } from '@heroui/react/textfield'
import { TextArea } from '@heroui/react/textarea'
import { Label } from '@heroui/react/label'
import { CompactButton } from './SettingsControls.js'
import { saveTaskNote, taskNoteText, type ReplyAnnotationSource } from './TaskNotes.js'
import { tw } from './tailwind.js'

export interface ReplyAnnotationDraft extends ReplyAnnotationSource { taskId: string }

export function ReplyAnnotationDialog({ source, onClose, onAdd }: {
  source: ReplyAnnotationDraft; onClose: () => void; onAdd: (text: string, preview: string) => void
}) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string>()
  const [savedId, setSavedId] = useState<string>()
  const add = () => {
    try {
      const id = saveTaskNote(source.taskId, comment, savedId, { messageId: source.messageId, quote: source.quote })
      setSavedId(id)
      const text = taskNoteText({ text: comment.trim(), source })
      onAdd(text, `批注：${comment.trim()}`)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '批注保存失败，请重试。') }
  }
  return <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open) onClose() }}>
    <Modal.Container size="sm"><Modal.Dialog>
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading>回复批注</Modal.Heading></Modal.Header>
      <Modal.Body className={tw('gap-4')}>
        <blockquote className={tw('m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[var(--panel-border)] pl-3 text-xs leading-5 text-[var(--text-secondary)]')}>{source.quote}</blockquote>
        <TextField autoFocus aria-label="批注评论" value={comment} onChange={setComment} isRequired maxLength={20000}>
          <Label>评论</Label><TextArea className={tw('min-h-24 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-3 text-xs')} placeholder="对这段回复有什么想法？" />
        </TextField>
        {error ? <p role="alert" className={tw('m-0 text-xs text-danger')}>{error}</p> : null}
      </Modal.Body>
      <Modal.Footer><CompactButton variant="ghost" onPress={onClose}>取消</CompactButton><CompactButton isDisabled={!comment.trim()} onPress={add}>加入输入框</CompactButton></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
