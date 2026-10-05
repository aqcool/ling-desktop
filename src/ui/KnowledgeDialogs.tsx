import { useState } from 'react'
import { Modal } from '@heroui/react/modal'
import type { KnowledgeLibrary } from '../runtime/knowledge.js'
import { CompactButton, CompactInput } from './SettingsControls.js'
import { tw } from './tailwind.js'
export type LibraryScopeChoice = { value: string; label: string }
export function LibraryDialog({
  library,
  scopes,
  scopeOnly = false,
  busy,
  error,
  onClose,
  onSave,
}: {
  library?: KnowledgeLibrary
  scopes: readonly LibraryScopeChoice[]
  scopeOnly?: boolean
  busy: boolean
  error: string
  onClose: () => void
  onSave: (
    name: string,
    access: 'all' | 'selected',
    bindings: string[],
  ) => Promise<void>
}) {
  const [name, setName] = useState(library?.name ?? '')
  const [access, setAccess] = useState<'all' | 'selected'>(
    library?.access ??
      (library?.workspaceId || library?.taskId ? 'selected' : 'all'),
  )
  const [bindings, setBindings] = useState<string[]>(
    library?.bindings?.map((binding) =>
      binding.taskId ? `remote:${binding.taskId}` : binding.workspaceId!,
    ) ??
      (library?.taskId
        ? [`remote:${library.taskId}`]
        : library?.workspaceId
          ? [library.workspaceId]
          : []),
  )
  const rename = !!library && !scopeOnly
  return (
    <Modal.Backdrop
      isOpen
      isDismissable={!busy}
      onOpenChange={(open: boolean) => {
        if (!open && !busy) onClose()
      }}
    >
      <Modal.Container size="sm">
        <Modal.Dialog className={tw('w-[460px] max-w-[calc(100vw-32px)]')}>
          <Modal.CloseTrigger aria-label="关闭" isDisabled={busy} />
          <Modal.Header>
            <Modal.Heading>
              {scopeOnly
                ? '管理生效范围'
                : rename
                  ? '重命名知识库'
                  : '创建知识库'}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className={tw('grid gap-5')}>
            {!scopeOnly ? (
              <label className={tw('grid gap-2 text-xs')}>
                <span className={tw('flex justify-between')}>
                  名称
                  <span className={tw('text-[var(--text-tertiary)]')}>
                    {name.length}/50
                  </span>
                </span>
                <CompactInput
                  aria-label="知识库名称"
                  autoFocus
                  value={name}
                  maxLength={50}
                  placeholder="例如：工程手册"
                  onChange={(
                    event: import('react').ChangeEvent<HTMLInputElement>,
                  ) => setName(event.target.value)}
                />
              </label>
            ) : null}
            {!rename ? (
              <fieldset
                disabled={busy}
                className={tw('m-0 min-w-0 border-0 p-0 text-xs')}
              >
                <legend className={tw('mb-3 font-medium')}>生效范围</legend>
                <div className={tw('flex gap-6')}>
                  {(
                    [
                      { value: 'all', label: '全部工作区' },
                      { value: 'selected', label: '指定工作区' },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.value}
                      className={tw('flex items-center gap-2')}
                    >
                      <input
                        type="radio"
                        name="library-access"
                        checked={access === item.value}
                        onChange={() => setAccess(item.value)}
                        className={tw('accent-[var(--foreground)]')}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
                {access === 'all' ? (
                  <p
                    className={tw(
                      'mb-0 mt-3 leading-6 text-[var(--text-secondary)]',
                    )}
                  >
                    当前本机配置中的所有现有及未来工作区均可检索此知识库。
                  </p>
                ) : (
                  <div
                    className={tw(
                      'mt-4 grid max-h-52 gap-1 overflow-auto rounded-lg border border-[var(--panel-border)] p-2',
                    )}
                  >
                    {scopes.length ? (
                      scopes.map((item) => (
                        <label
                          key={item.value}
                          className={tw(
                            'flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-[var(--surface-hover)]',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={bindings.includes(item.value)}
                            onChange={(event) =>
                              setBindings((values) =>
                                event.target.checked
                                  ? [...values, item.value]
                                  : values.filter(
                                      (value) => value !== item.value,
                                    ),
                              )
                            }
                            className={tw('accent-[var(--foreground)]')}
                          />
                          <span className={tw('truncate')}>{item.label}</span>
                        </label>
                      ))
                    ) : (
                      <p
                        className={tw(
                          'm-1 leading-5 text-[var(--text-secondary)]',
                        )}
                      >
                        请先添加工作区。
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
            ) : null}
            {error ? (
              <p
                role="alert"
                className={tw('m-0 text-xs text-[var(--danger)]')}
              >
                {error}
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <CompactButton
              variant="tertiary"
              isDisabled={busy}
              onPress={onClose}
            >
              取消
            </CompactButton>
            <CompactButton
              isDisabled={
                busy ||
                !name.trim() ||
                (!rename && access === 'selected' && !bindings.length)
              }
              onPress={() => {
                void onSave(name, access, bindings)
              }}
            >
              {library ? '保存' : '创建知识库'}
            </CompactButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
export function KnowledgeDeleteDialog({
  name,
  busy,
  error,
  onClose,
  onDelete,
}: {
  name: string
  busy: boolean
  error: string
  onClose: () => void
  onDelete: () => void
}) {
  return (
    <Modal.Backdrop
      isOpen
      isDismissable={!busy}
      onOpenChange={(open: boolean) => {
        if (!open && !busy) onClose()
      }}
    >
      <Modal.Container size="sm">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>删除知识库</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className={tw('m-0 text-sm leading-6')}>
              删除「{name}」及其中的资料。项目文件和原始会话不受影响。
            </p>
            {error ? (
              <p role="alert" className={tw('text-xs text-[var(--danger)]')}>
                {error}
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <CompactButton
              variant="tertiary"
              isDisabled={busy}
              onPress={onClose}
            >
              取消
            </CompactButton>
            <CompactButton
              variant="danger"
              isDisabled={busy}
              onPress={onDelete}
            >
              删除
            </CompactButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
