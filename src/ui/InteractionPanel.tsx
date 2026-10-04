import { useBehavior } from './behavior-preferences.js'
import { Button } from '@heroui/react/button'
import { useEffect, useRef, useState } from 'react'
import type { LingPendingInteraction, LingQuestion, LingQuestionAnswer } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'
import { toolLabel } from './tool-labels.js'

interface InteractionPanelProps {
  readonly interactions: readonly LingPendingInteraction[]
  readonly onApprove: (interactionId: string, decision: 'allowed-once' | 'rejected') => void | Promise<unknown>
  readonly onAnswer: (interactionId: string, answers: readonly LingQuestionAnswer[]) => void | Promise<unknown>
  readonly onCancel: (interactionId: string) => void | Promise<unknown>
}

function QuestionBlock({
  question,
  selected,
  custom,
  onToggle,
  onCustom,
}: {
  readonly question: LingQuestion
  readonly selected: readonly string[]
  readonly custom: string
  readonly onToggle: (label: string, checked: boolean) => void
  readonly onCustom: (value: string) => void
}) {
  return (
    <div className={tw("interaction__question grid gap-1.5")}>
      {question.header ? <span className={tw("interaction__header [color:var(--text-tertiary)] text-caption [font-weight:570]")}>{question.header}</span> : null}
      <p className={tw("interaction__prompt m-0 [color:var(--foreground)] text-sm")}>{question.prompt}</p>
      {question.detail ? <p className={tw("interaction__detail m-0 [color:var(--text-secondary)] text-xs [overflow-wrap:anywhere]")}>{question.detail}</p> : null}
      <div className={tw("interaction__options grid gap-1")}>
        {question.options.map(option => (
          <label className={tw("interaction__option grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-[var(--panel-border)] px-2 py-1.5 text-compact hover:bg-[var(--surface-secondary)] bg-[var(--surface)]")} key={option.label}>
            <input
              className={tw("mt-1")}
              checked={selected.includes(option.label)}
              name={question.questionId}
              onChange={event => { onToggle(option.label, event.target.checked) }}
              type={question.multiple ? 'checkbox' : 'radio'}
            />
            <span className={tw("grid min-w-0 gap-0.5")}>
              <strong>{option.label}</strong>
              {option.description ? <small className={tw("text-caption text-[var(--text-secondary)]")}>{option.description}</small> : null}
            </span>
          </label>
        ))}
      </div>
      <input
        className={tw("interaction__custom rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2 py-1.5 text-compact text-inherit focus:border-[var(--panel-border)] focus:outline-0")}
        onChange={event => { onCustom(event.target.value) }}
        placeholder="或输入自定义回答…"
        type="text"
        value={custom}
      />
    </div>
  )
}

export function scheduleIdleQuestion(target: EventTarget, milliseconds: number, skip: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>
  const dispose = () => { clearTimeout(timer); target.removeEventListener('pointerdown', reset); target.removeEventListener('keydown', reset) }
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => { dispose(); skip() }, milliseconds) }
  target.addEventListener('pointerdown', reset); target.addEventListener('keydown', reset)
  reset()
  return dispose
}

function QuestionInteraction({
  interaction,
  onAnswer,
  onCancel,
}: {
  readonly interaction: Extract<LingPendingInteraction, { kind: 'question' | 'plan-review' }>
  readonly onAnswer: (interactionId: string, answers: readonly LingQuestionAnswer[]) => void | Promise<unknown>
  readonly onCancel: (interactionId: string) => void | Promise<unknown>
}) {
  const behavior = useBehavior()
  const [touched, setTouched] = useState(false)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [customs, setCustoms] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!behavior.questionTimeout || interaction.kind !== 'question' || pending || touched) return
    return scheduleIdleQuestion(window, behavior.questionTimeout * 1000, () => { void skip() })
  }, [behavior.questionTimeout, interaction.interactionId, interaction.kind, pending, touched])

  const toggle = (questionId: string, label: string, multiple: boolean, checked: boolean) => {
    setTouched(true)
    setSelections(current => {
      const existing = current[questionId] ?? []
      const next = multiple
        ? (checked ? [...existing, label] : existing.filter(item => item !== label))
        : [label]
      return { ...current, [questionId]: next }
    })
  }

  const submit = async () => {
    if (pending) return
    setPending(true); setError(undefined)
    const answers: LingQuestionAnswer[] = interaction.questions.map(question => ({
      questionId: question.questionId,
      selected: selections[question.questionId] ?? [],
      ...(customs[question.questionId]?.trim() ? { custom: customs[question.questionId]!.trim() } : {}),
    }))
    try { await onAnswer(interaction.interactionId, answers) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '提交失败，请重试。') }
    finally { setPending(false) }
  }

  const skip = async () => {
    if (pending) return
    setPending(true); setTouched(true); setError(undefined)
    try { await cancelRef.current(interaction.interactionId) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '跳过失败，请重试。') }
    finally { setPending(false) }
  }

  const kindLabel = interaction.kind === 'plan-review' ? '计划审阅' : '需要你的回答'

  return (
    <div className={tw("interaction interaction--question grid min-w-0 gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-4")}>
      <div className={tw("interaction__title flex items-center gap-1.5 [color:var(--foreground)] text-sm [font-weight:620]")}>
        <Icon name="help" size={16} />
        <span>{kindLabel}</span>
      </div>
      {interaction.questions.map(question => (
        <QuestionBlock
          custom={customs[question.questionId] ?? ''}
          key={question.questionId}
          onCustom={value => { setTouched(true); setCustoms(current => ({ ...current, [question.questionId]: value })) }}
          onToggle={(label, checked) => { toggle(question.questionId, label, question.multiple, checked) }}
          question={question}
          selected={selections[question.questionId] ?? []}
        />
      ))}
      {error ? <p role="alert" className={tw("m-0 text-xs text-[var(--danger)]")}>{error}</p> : null}
      <div className={tw("interaction__actions sticky bottom-0 flex justify-end gap-1.5 bg-inherit pt-1")}>
        <Button isDisabled={pending} onPress={() => { void skip() }} size="sm" variant="ghost">跳过</Button>
        <Button isDisabled={pending} onPress={submit} size="sm">{pending ? '正在提交…' : '提交回答'}</Button>
      </div>
    </div>
  )
}

function ApprovalInteraction({
  interaction,
  onApprove,
}: {
  readonly interaction: Extract<LingPendingInteraction, { kind: 'approval' }>
  readonly onApprove: (interactionId: string, decision: 'allowed-once' | 'rejected') => void | Promise<unknown>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const decide = async (decision: 'allowed-once' | 'rejected') => {
    if (pending) return
    setPending(true); setError(undefined)
    try { await onApprove(interaction.interactionId, decision) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '审批提交失败，请重试。') }
    finally { setPending(false) }
  }
  return (
    <div className={tw("interaction interaction--approval grid min-w-0 gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-4")}>
      <div className={tw("interaction__title flex items-center gap-1.5 [color:var(--foreground)] text-sm [font-weight:620]")}>
        <Icon className={tw("shrink-0")} name="shield" size={16} />
        <span className={tw("min-w-0 [overflow-wrap:anywhere]")}>{interaction.details?.summary ?? `${toolLabel(interaction.toolName)} 想要执行一个操作`}</span>
      </div>
      {interaction.details ? <>
        <p className={tw('m-0 break-words text-xs leading-5 text-[var(--text-secondary)]')}>{interaction.details.server} · <span className={tw('font-mono')}>{interaction.details.cwd}</span></p>
        <p className={tw('m-0 text-xs leading-5 text-[var(--text-secondary)]')}>{interaction.details.impact}</p>
        {interaction.details.source ? <p className={tw('m-0 break-all text-xs text-[var(--text-secondary)]')}>来源：{interaction.details.source}</p> : null}
        {interaction.details.destination ? <p className={tw('m-0 break-all text-xs text-[var(--text-secondary)]')}>目标：{interaction.details.destination}</p> : null}
        {interaction.details.command ? <details className={tw('min-w-0 text-xs text-[var(--text-secondary)]')}>
          <summary className={tw('w-fit cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]')}>查看完整命令</summary>
          <pre className={tw('mb-0 mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--surface-secondary)] p-2.5 font-mono text-xs leading-5')}><code>{interaction.details.command}</code></pre>
        </details> : null}
      </> : interaction.reason ? <pre className={tw("interaction__detail m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--surface-secondary)] px-3 py-2 font-mono text-xs leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]")}>{interaction.reason}</pre> : null}
      {error ? <p role="alert" className={tw("m-0 text-xs text-[var(--danger)]")}>{error}</p> : null}
      <div className={tw("interaction__actions sticky bottom-0 flex justify-end gap-2 border-t border-dashed border-[var(--panel-border)] bg-inherit pt-3")}>
        <Button isDisabled={pending} onPress={() => { void decide('rejected') }} size="sm" variant="secondary">拒绝</Button>
        <Button isDisabled={pending} onPress={() => { void decide('allowed-once') }} size="sm">允许一次</Button>
      </div>
    </div>
  )
}

export function InteractionPanel({ interactions, onApprove, onAnswer, onCancel }: InteractionPanelProps) {
  if (interactions.length === 0) return null
  return (
    <div className={tw("interaction-panel mb-3 grid min-h-0 w-full min-w-0 flex-[0_1_auto] gap-2 [max-height:min(26rem,_calc(100vh_-_26rem))] overflow-y-auto [overscroll-behavior:contain]")} role="group" aria-label="待处理交互">
      {interactions.map(interaction => (
        interaction.kind === 'approval'
          ? <ApprovalInteraction interaction={interaction} key={interaction.interactionId} onApprove={onApprove} />
          : <QuestionInteraction interaction={interaction} key={interaction.interactionId} onAnswer={onAnswer} onCancel={onCancel} />
      ))}
    </div>
  )
}
