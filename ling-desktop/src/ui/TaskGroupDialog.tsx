import { CompactButton as Button } from './SettingsControls.js'
import { CompactInput as Input } from './SettingsControls.js'
import { Label } from '@heroui/react/label'
import { Modal } from '@heroui/react/modal'
import { TextField } from '@heroui/react/textfield'
import { useState, type CSSProperties, type FormEvent } from 'react'
import { Icon } from './Icon.js'
import type { TaskGroup } from './task-view.js'
import { tw } from './tailwind.js'

const colors = ['#cc6648', '#d89439', '#c2a346', '#65a56b', '#50a99d', '#5293c4', '#777fc2', '#aa79ad']
const markers = ['folder', 'target', 'sparkle', 'code', 'branch', 'clock', 'palette', 'terminal'] as const

export function TaskGroupDialog({ initial, onCancel, onConfirm }: {
  readonly initial?: TaskGroup
  readonly onCancel: () => void
  readonly onConfirm: (group: TaskGroup) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? colors[0]!)
  const [marker, setMarker] = useState(initial?.marker ?? markers[0])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onConfirm({ id: initial?.id ?? crypto.randomUUID(), name: name.trim(), color, marker })
    onCancel()
  }
  return (
    <Modal.Backdrop isOpen onOpenChange={(open: boolean) => { if (!open) onCancel() }} variant="blur">
      <Modal.Container size="sm"><Modal.Dialog className={tw("gap-4 rounded-2xl p-5")}><Modal.CloseTrigger />
        <Modal.Header><Modal.Heading className={tw("text-base font-semibold")}>{initial ? '编辑分组' : '新建分组'}</Modal.Heading></Modal.Header>
        <form onSubmit={submit}>
          <Modal.Body>
            <TextField autoFocus onChange={setName} value={name} variant="secondary"><Label>分组名称</Label><Input placeholder="输入分组名称" /></TextField>
            <div className={tw("workspace-create__source grid gap-2")}><Label className={tw("text-xs font-semibold text-[var(--text-secondary)]")}>标记</Label><div className={tw("workspace-create__choices flex flex-wrap [gap:0.45rem]")}>
              {markers.map(value => <button aria-label={`标记 ${value}`} aria-pressed={marker === value} className={tw("workspace-create__choice grid [width:2rem] [height:2rem] place-items-center [border:1px_solid_var(--border)] [border-radius:0.5rem] [background:var(--surface)] [color:var(--text-secondary)] cursor-pointer aria-pressed:[border-color:var(--foreground)] aria-pressed:[box-shadow:0_0_0_1px_var(--foreground)]")} key={value} onClick={() => { setMarker(value) }} type="button"><Icon name={value} size={18} /></button>)}
            </div></div>
            <div className={tw("workspace-create__source grid gap-2")}><Label className={tw("text-xs font-semibold text-[var(--text-secondary)]")}>颜色</Label><div className={tw("workspace-create__choices flex flex-wrap [gap:0.45rem]")}>
              {colors.map(value => <button aria-label={`颜色 ${value}`} aria-pressed={color === value} className={tw("workspace-create__choice grid [width:2rem] [height:2rem] place-items-center [border:1px_solid_var(--border)] [border-radius:0.5rem] [background:var(--surface)] [color:var(--text-secondary)] cursor-pointer aria-pressed:[border-color:var(--foreground)] aria-pressed:[box-shadow:0_0_0_1px_var(--foreground)] workspace-create__swatch after:[width:1rem] after:[height:1rem] after:[border-radius:50%] after:[background:var(--workspace-swatch)] after:[content:'']")} key={value} onClick={() => { setColor(value) }} style={{ '--workspace-swatch': value } as CSSProperties} type="button" />)}
            </div></div>
          </Modal.Body>
          <Modal.Footer className={tw("gap-2")}><Button onPress={onCancel} variant="ghost">取消</Button><Button isDisabled={!name.trim()} type="submit" variant="primary">{initial ? '保存' : '创建'}</Button></Modal.Footer>
        </form>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  )
}
