import type { LingCommandResult } from '../runtime/contract.js'
import { tw } from './tailwind.js'

export type RetryRunner = () => Promise<LingCommandResult>

export function retryPending(
  result: LingCommandResult,
  retry: RetryRunner | undefined,
): retry is RetryRunner {
  return !result.accepted && result.retryable && retry !== undefined
}

interface ComposerNoticeProps {
  readonly message: string
  readonly onRetry?: () => void
}

export function ComposerNotice({ message, onRetry }: ComposerNoticeProps) {
  return (
    <p className={tw("composer-notice flex flex-none items-center gap-2 mt-0 mx-0 mb-2 py-0 px-3 [color:var(--danger)] text-xs")} role="status">
      <span>{message}</span>
      {onRetry ? <button className={tw("composer-notice__retry [border:1px_solid_currentColor] rounded-md bg-transparent [color:inherit] cursor-pointer [font:inherit] py-0 px-1.5 hover:[background:var(--danger-subtle)] focus-visible:[outline:2px_solid_var(--danger)] focus-visible:[outline-offset:1px]")} onClick={onRetry} type="button">重试</button> : null}
    </p>
  )
}
