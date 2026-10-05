/** Deliberately excludes application state, request bodies and environment variables. */
export interface LingRendererFailure {
  readonly message: string
  readonly stack?: string
  readonly componentStack?: string
}

/** Error strings can still contain credentials supplied by a plugin or transport. */
export function redactDiagnostic(value: string, home?: string): string {
  let text = value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu, '[private key removed]')
    .replace(/\bBearer\s+[^\s,;"']+/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/gu, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[redacted]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|passphrase|authorization|cookie|secret)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/giu, '$1[redacted]')
    .replace(/\b(?:https?|wss?|sftp|ssh):\/\/[^\s<>"')]+/giu, value => {
      try {
        const url = new URL(value)
        if (url.username || url.password) { url.username = '[redacted]'; url.password = '' }
        if (url.search) url.search = '?[redacted]'
        if (url.hash) url.hash = '#[redacted]'
        return url.toString()
      } catch { return '[invalid URL removed]' }
    })
  if (home) text = text.split(home).join('~')
  return text.slice(0, 12_000)
}

export function rendererFailure(error: unknown, componentStack?: string | null): LingRendererFailure {
  return {
    message: redactDiagnostic(error instanceof Error ? error.message : String(error)).slice(0, 4096),
    ...(error instanceof Error && error.stack ? { stack: redactDiagnostic(error.stack).slice(0, 8192) } : {}),
    ...(componentStack ? { componentStack: redactDiagnostic(componentStack).slice(0, 4096) } : {}),
  }
}

declare global {
  interface Window {
    __LING_RECOVERY__?: {
      ready(): Promise<void>
      report(failure: LingRendererFailure): Promise<void>
      reload(): Promise<void>
      copy(failure: LingRendererFailure): Promise<void>
    }
  }
}
