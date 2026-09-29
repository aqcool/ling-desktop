import { CompactButton as Button } from './SettingsControls.js'
import { CompactInput as Input } from './SettingsControls.js'
import { Label } from '@heroui/react/label'
import { Modal } from '@heroui/react/modal'
import { TextField } from '@heroui/react/textfield'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { tw } from './tailwind.js'

interface PromptDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly label: string
  readonly placeholder?: string
  readonly confirmLabel?: string
  readonly initialValue?: string
  readonly isDanger?: boolean
  readonly onCancel: () => void
  readonly onConfirm: (value: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
}

export function PromptDialog({
  open,
  title,
  description,
  label,
  placeholder,
  confirmLabel = '确定',
  initialValue = '',
  isDanger,
  onCancel,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const formRef = useRef<HTMLFormElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const node = event.target
      if (!(node instanceof HTMLElement)) return
      if (node === document.body || node.closest('[role="dialog"], [role="menu"]')) return
      openerRef.current = node
    }
    document.addEventListener('focusin', onFocusIn)
    return () => { document.removeEventListener('focusin', onFocusIn) }
  }, [])

  useEffect(() => {
    if (!open) return
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      if (!opener?.isConnected) return
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) opener.focus()
      })
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setValue(initialValue)
      setError(undefined)
      setPending(false)
    }
  }, [open, initialValue])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending || !value.trim()) return
    setPending(true)
    setError(undefined)
    try {
      const result = await onConfirm(value.trim())
      if (!result.accepted) {
        setError(result.message ?? '操作未能完成。')
        setPending(false)
        return
      }
      onCancel()
    } catch {
      setError('操作未能完成。')
    } finally {
      setPending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    formRef.current?.requestSubmit()
  }

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(next: boolean) => { if (!next) onCancel() }} variant="blur">
      <Modal.Container size="sm">
        <Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className={tw("text-base font-semibold")}>{title}</Modal.Heading>
            {description ? <p>{description}</p> : null}
          </Modal.Header>
          <form ref={formRef} onSubmit={event => { void submit(event) }}>
            <Modal.Body>
              <TextField
                autoFocus
                isDisabled={pending}
                name="prompt-dialog-value"
                onChange={setValue}
                value={value}
                variant="secondary"
              >
                <Label>{label}</Label>
                <Input onKeyDown={onKeyDown} placeholder={placeholder} />
              </TextField>
              {error ? <p className={tw("prompt-dialog__error [margin:0.55rem_0_0] [color:#a6473f] [font-size:0.75rem]")} role="status">{error}</p> : null}
            </Modal.Body>
            <Modal.Footer className={tw("gap-2")}>
              <Button isDisabled={pending} onPress={onCancel} slot="close" variant="ghost">取消</Button>
              <Button
                isPending={pending}
                type="submit"
                variant={isDanger ? 'danger' : 'primary'}
              >
                {confirmLabel}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
