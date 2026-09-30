import { Button } from '@heroui/react/button'
import { Input } from '@heroui/react/input'
import { Label } from '@heroui/react/label'
import { Modal } from '@heroui/react/modal'
import { TextField } from '@heroui/react/textfield'
import { useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react'
import type { LingCommandResult, LingReadResult } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

const colors = [
  '#c96343', '#50705a', '#0c5ca4', '#8b5908', '#c73343',
  '#ec3e90', '#6156eb', '#ffc321', '#ff7a2d', '#13a799',
  '#0a87ef', '#8d8d9e', '#253044', '#b493ff', '#64ad93',
]
const markers = [
  'folder', 'coffee', 'martini', 'cupcake', 'pacman',
  'chessKnight', 'robot', 'seal', 'insect', 'target',
  'cat', 'ghost', 'alien', 'rocket', 'flask',
] as const

export interface WorkspaceDraft {
  readonly path: string
  readonly name: string
  readonly color: string
  readonly marker: string
}

export function WorkspaceCreateDialog({ onCancel, onChooseDirectory, onConfirm }: {
  readonly onCancel: () => void
  readonly onChooseDirectory?: () => Promise<LingReadResult<string | undefined>>
  readonly onConfirm: (draft: WorkspaceDraft) => Promise<LingCommandResult>
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(colors[0]!)
  const [marker, setMarker] = useState<string>(markers[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const choose = async () => {
    if (!onChooseDirectory) return
    const result = await onChooseDirectory()
    if (!result.ok) { setError(result.message); return }
    if (!result.value) return
    setPath(result.value)
    if (!name) setName(result.value.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? '')
    setError(undefined)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!path.trim() || !name.trim() || pending) return
    setPending(true)
    setError(undefined)
    try {
      const result = await onConfirm({ path: path.trim(), name: name.trim(), color, marker })
      if (result.accepted) onCancel()
      else setError(result.message ?? '创建工作区失败。')
    } catch { setError('创建工作区失败。') }
    finally { setPending(false) }
  }

  return (
    <Modal.Backdrop className={tw("workspace-create-dialog__backdrop bg-[var(--overlay-scrim)]")} isOpen onOpenChange={(open: boolean) => { if (!open) onCancel() }} variant="opaque">
      <Modal.Container className={tw("workspace-create-dialog__container h-[min(31.25rem,calc(100vh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] flex-[0_1_auto] p-0")} placement="center" scroll="inside" size="cover">
        <Modal.Dialog className={tw("workspace-create-dialog h-full min-h-0 w-full max-w-none rounded-xl bg-[var(--surface-secondary)] p-2")}>
          <Modal.CloseTrigger className={tw("workspace-create-dialog__close right-3 top-3 grid size-control-sm place-items-center rounded-md bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-hover)]")}><Icon className={tw("size-4")} name="close" size={23} /></Modal.CloseTrigger>
          <Modal.Header className={tw("workspace-create-dialog__header min-h-11 flex-none justify-center px-3")}><Modal.Heading className={tw("text-lg font-bold")}>新建工作区</Modal.Heading></Modal.Header>
          <form className={tw("workspace-create-dialog__form flex min-h-0 flex-1 flex-col")} onSubmit={event => { void submit(event) }}>
            <Modal.Body className={tw("workspace-create-dialog__body m-0 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg bg-[var(--surface)] p-3.5 text-[var(--foreground)] max-[600px]:gap-3.5")}>
              <div className={tw("workspace-create-dialog__section grid min-w-0 gap-1.5")}>
                <Label className={tw("text-sm font-bold text-[var(--foreground)]")}>源文件夹</Label>
                {onChooseDirectory ? (
                  <Button aria-label={path ? '更换可读写文件夹' : '添加可读写文件夹'} className={tw("workspace-create-dialog__dropzone relative flex min-h-31 w-full flex-row items-center justify-center gap-1.5 overflow-hidden rounded-lg border-4 border-[var(--surface-secondary)] bg-[var(--surface)] text-sm font-bold text-[var(--text-secondary)] shadow-none after:pointer-events-none after:absolute after:inset-0 after:rounded-sm after:border after:border-dashed after:border-[var(--border)] after:content-[''] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)] has-[small]:flex-col max-[600px]:min-h-24")} isDisabled={pending} onPress={() => { void choose() }} variant="outline">
                    <Icon className={tw("flex-none")} name={path ? 'folder' : 'folderPlus'} size={18} />
                    <span>{path ? path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) : '选择文件夹'}</span>
                    {path ? <small className={tw("max-w-[80%] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal text-[var(--text-tertiary)]")}>{path}</small> : null}
                  </Button>
                ) : (
                  <Input aria-label="项目目录" className={tw("workspace-create-dialog__path-fallback min-h-8 w-full")} onChange={(event: ChangeEvent<HTMLInputElement>) => { setPath(event.target.value) }} placeholder="输入本地项目目录" value={path} />
                )}
              </div>
              <TextField className={tw("workspace-create-dialog__section workspace-create-dialog__name grid min-w-0 gap-1.5")} onChange={setName} value={name} variant="secondary">
                <Label className={tw("text-sm font-bold text-[var(--foreground)]")}>工作区名称</Label><Input autoFocus className={tw("min-h-control w-full rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--foreground)] focus:border-[var(--panel-border)] focus:outline-none focus:ring-1 focus:ring-[var(--focus)]")} placeholder="输入名称..." />
              </TextField>
              <div className={tw("workspace-create-dialog__section grid min-w-0 gap-1.5")}>
                <Label className={tw("text-sm font-bold text-[var(--foreground)]")}>工作区图标</Label>
                <div aria-label="工作区图标" className={tw("workspace-create-dialog__choices grid [grid-template-columns:repeat(15,_minmax(0,_1fr))] gap-1 max-[600px]:[grid-template-columns:repeat(8,_minmax(0,_1fr))]")} role="group">
                  {markers.map(value => <button aria-label={`图标 ${value}`} aria-pressed={marker === value} className={tw("workspace-create-dialog__choice grid aspect-square w-full max-w-8 cursor-pointer place-items-center rounded-md border border-transparent bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)] hover:text-[var(--foreground)] aria-pressed:border-[var(--action)] aria-pressed:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]")} key={value} onClick={() => { setMarker(value) }} type="button"><Icon className={tw("size-[1.15rem]")} name={value} size={23} /></button>)}
                </div>
              </div>
              <div className={tw("workspace-create-dialog__section grid min-w-0 gap-1.5")}>
                <Label className={tw("text-sm font-bold text-[var(--foreground)]")}>工作区颜色</Label>
                <div aria-label="工作区颜色" className={tw("workspace-create-dialog__choices grid [grid-template-columns:repeat(15,_minmax(0,_1fr))] gap-1 max-[600px]:[grid-template-columns:repeat(8,_minmax(0,_1fr))]")} role="group">
                  {colors.map(value => <button aria-label={`颜色 ${value}`} aria-pressed={color === value} className={tw("workspace-create-dialog__choice workspace-create-dialog__swatch grid aspect-square w-full max-w-8 cursor-pointer place-items-center rounded-md border border-transparent bg-[var(--surface-secondary)] text-[var(--text-secondary)] after:size-4 after:rounded-full after:bg-[var(--workspace-swatch)] after:content-[''] hover:bg-[var(--surface-tertiary)] hover:text-[var(--foreground)] aria-pressed:border-[var(--action)] aria-pressed:bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]")} key={value} onClick={() => { setColor(value) }} style={{ '--workspace-swatch': value } as CSSProperties} type="button" />)}
                </div>
              </div>
              {error ? <p className={tw("prompt-dialog__error mt-2 mx-0 mb-0 [color:var(--danger)] text-xs")} role="status">{error}</p> : null}
            </Modal.Body>
            <Modal.Footer className={tw("workspace-create-dialog__footer mt-0 min-h-11 flex-none gap-1.5 pt-1")}>
              <Button className={tw("workspace-create-dialog__cancel min-h-control min-w-15 text-sm font-bold")} isDisabled={pending} onPress={onCancel} variant="ghost">取消</Button>
              <Button className={tw("workspace-create-dialog__create min-h-control min-w-15 bg-[var(--action)] text-sm font-bold text-[var(--action-foreground)] data-disabled:bg-[var(--action)] data-disabled:text-[var(--action-foreground)] data-disabled:opacity-100")} isDisabled={!path.trim() || !name.trim()} isPending={pending} type="submit" variant="primary">创建</Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
