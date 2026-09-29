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
    <p className={tw("composer-notice flex flex-none items-center [gap:0.5rem] [margin:0_0_0.45rem] [padding:0_0.8rem] [color:#9d3a32] [font-size:0.75rem] dark:[color:#e08a80]")} role="status">
      <span>{message}</span>
      {onRetry ? <button className={tw("composer-notice__retry [border:1px_solid_currentColor] [border-radius:0.42rem] bg-transparent [color:inherit] cursor-pointer [font:inherit] [padding:0.04rem_0.42rem] hover:[background:rgb(157_58_50_/_0.08)] focus-visible:[outline:2px_solid_#9d3a32] focus-visible:[outline-offset:1px] dark:hover:[background:rgb(224_138_128_/_0.12)] dark:focus-visible:[outline-color:#e08a80]")} onClick={onRetry} type="button">重试</button> : null}
    </p>
  )
}
