import { randomUUID } from 'node:crypto'

/** A renderer can acknowledge only its own one-use preparation request. */
export class UpdateRendererChecks {
  private readonly pending = new Map<string, { sender: number; finish(reason?: string): void }>()
  async request(sender: number, send: (token: string) => void, timeoutMs = 5_000): Promise<string | undefined> {
    const token = randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise(resolve => {
        this.pending.set(token, { sender, finish: resolve })
        timer = setTimeout(() => resolve('无法确认窗口内容已保存，请稍后重试更新。'), timeoutMs)
        try { send(token) } catch { resolve('窗口已关闭或暂时无法响应，请稍后重试更新。') }
      })
    } finally {
      clearTimeout(timer)
      this.pending.delete(token)
    }
  }
  acknowledge(sender: number, token: unknown, reason: unknown): void {
    if (typeof token !== 'string') return
    const request = this.pending.get(token)
    if (!request || request.sender !== sender) return
    request.finish(reason === undefined ? undefined : typeof reason === 'string' && reason.trim()
      ? reason.slice(0, 500) : '无法确认窗口内容已保存，请稍后重试更新。')
    this.pending.delete(token)
  }
}
