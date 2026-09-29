import { useBehavior } from './behavior-preferences.js'
import { Button } from '@heroui/react/button'
import { useEffect, useRef, useState } from 'react'
import type { LingPendingInteraction, LingQuestion, LingQuestionAnswer } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

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
    <div className={tw("interaction__question grid [gap:0.35rem]")}>
      {question.header ? <span className={tw("interaction__header [color:var(--text-tertiary)] [font-size:0.68rem] [font-weight:570]")}>{question.header}</span> : null}
      <p className={tw("interaction__prompt dark:[color:#d6d6d9] m-0 [color:#333] [font-size:0.875rem]")}>{question.prompt}</p>
      {question.detail ? <p className={tw("interaction__detail dark:[color:#b6b6bc] m-0 [color:var(--text-secondary)] [font-size:0.78rem] [overflow-wrap:anywhere]")}>{question.detail}</p> : null}
      <div className={tw("interaction__options grid [gap:0.25rem]")}>
        {question.options.map(option => (
          <label className={tw("interaction__option grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border border-[#eaeae7] px-2 py-1.5 text-[0.8rem] hover:bg-[#f7f7f6] dark:border-[#34343a] dark:bg-[#1d1d20] dark:text-[#d4d4d7] dark:hover:bg-[#242428]")} key={option.label}>
            <input
              className={tw("mt-1")}
              checked={selected.includes(option.label)}
              name={question.questionId}
              onChange={event => { onToggle(option.label, event.target.checked) }}
              type={question.multiple ? 'checkbox' : 'radio'}
            />
            <span className={tw("grid min-w-0 gap-0.5")}>
              <strong>{option.label}</strong>
              {option.description ? <small className={tw("text-[0.71rem] text-[#676767] dark:text-[#a3a3a8]")}>{option.description}</small> : null}
            </span>
          </label>
        ))}
      </div>
      <input
        className={tw("interaction__custom rounded-lg border border-[#e4e4e1] bg-[#fbfbfa] px-2 py-1.5 text-[0.79rem] text-inherit focus:border-[#b9b9b4] focus:outline-0 dark:border-[#3a3a3f] dark:bg-[#1d1d20] dark:text-[#e0e0e3] dark:focus:border-[#6f6f77]")}
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
    <div className={tw("interaction dark:[background:#232327] dark:[border-color:#34343a] grid [gap:0.55rem] [padding:0.75rem_0.9rem] [border:1px_solid_#e3e3df] [border-radius:0.85rem] [background:#fff] [box-shadow:0_10px_26px_rgb(0_0_0_/_0.06)] interaction--question [border-left:3px_solid_#4d7fbe]")}>
      <div className={tw("interaction__title dark:[color:#e8e8ea] flex items-center [gap:0.4rem] [color:#2b2b2b] [font-size:0.875rem] [font-weight:620]")}>
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
    <div className={tw("interaction dark:[background:#232327] dark:[border-color:#34343a] grid [gap:0.55rem] [padding:0.75rem_0.9rem] [border:1px_solid_#e3e3df] [border-radius:0.85rem] [background:#fff] [box-shadow:0_10px_26px_rgb(0_0_0_/_0.06)] interaction--approval [border-left:3px_solid_#b98931]")}>
      <div className={tw("interaction__title dark:[color:#e8e8ea] flex items-center [gap:0.4rem] [color:#2b2b2b] [font-size:0.875rem] [font-weight:620]")}>
        <Icon className={tw("shrink-0")} name="shield" size={16} />
        <span className={tw("min-w-0 [overflow-wrap:anywhere]")}>{interaction.details?.summary ?? `确认执行 · ${interaction.toolName}`}</span>
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
      </> : interaction.reason ? <p className={tw("interaction__detail dark:[color:#b6b6bc] m-0 [color:var(--text-secondary)] [font-size:0.78rem] [overflow-wrap:anywhere]")}>{interaction.reason}</p> : null}
      {error ? <p role="alert" className={tw("m-0 text-xs text-[var(--danger)]")}>{error}</p> : null}
      <div className={tw("interaction__actions sticky bottom-0 flex justify-end gap-1.5 bg-inherit pt-1")}>
        <Button isDisabled={pending} onPress={() => { void decide('rejected') }} size="sm" variant="ghost">拒绝</Button>
        <Button isDisabled={pending} onPress={() => { void decide('allowed-once') }} size="sm">允许一次</Button>
      </div>
    </div>
  )
}

export function InteractionPanel({ interactions, onApprove, onAnswer, onCancel }: InteractionPanelProps) {
  if (interactions.length === 0) return null
  return (
    <div className={tw("interaction-panel grid [gap:0.5rem] [margin:0_auto_0.5rem] [width:min(48rem,_calc(100%_-_5rem))] [flex:0_1_auto] min-h-0 [max-height:min(26rem,_calc(100vh_-_26rem))] overflow-y-auto [overscroll-behavior:contain] max-[980px]:[width:calc(100%_-_2.5rem)] max-[700px]:[width:calc(100%_-_2rem)]")} role="group" aria-label="待处理交互">
      {interactions.map(interaction => (
        interaction.kind === 'approval'
          ? <ApprovalInteraction interaction={interaction} key={interaction.interactionId} onApprove={onApprove} />
          : <QuestionInteraction interaction={interaction} key={interaction.interactionId} onAnswer={onAnswer} onCancel={onCancel} />
      ))}
    </div>
  )
}
