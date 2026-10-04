/** Serialize explicit session mutations against LING's permanent-delete boundary. */
import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type {} from './session-lifecycle.ts'
export class LingSessionController extends SessionController {
  static override inject = [...SessionController.inject, 'lingSessionLifecycle']
  override resolveAgent(...args: Parameters<SessionController['resolveAgent']>) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(args[0], () => super.resolveAgent(...args))
  }
  override create(...args: Parameters<SessionController['create']>) {
    const id = args[0].sessionId
    return id === undefined ? super.create(...args) : this.ctx.lingSessionLifecycle.withSessionOperation(id, () => super.create(...args))
  }
  override prompt(...args: Parameters<SessionController['prompt']>) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(args[0].sessionId, () => super.prompt(...args))
  }
  override rename(...args: Parameters<SessionController['rename']>) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(args[0].sessionId, () => super.rename(...args))
  }
  override fork(...args: Parameters<SessionController['fork']>) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(args[0].sessionId, () => super.fork(...args))
  }
  override selectModel(...args: Parameters<SessionController['selectModel']>) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(args[0].sessionId, () => super.selectModel(...args))
  }
  override updateQueue(...args: Parameters<SessionController['updateQueue']>) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(args[0].sessionId, () => super.updateQueue(...args))
  }
}
export default LingSessionController
