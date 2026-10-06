/** Serialize explicit session mutations against LING's permanent-delete boundary. */
import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type {} from './session-lifecycle.ts'
export class LingSessionController extends SessionController {
  static override inject = [...SessionController.inject, 'lingSessionLifecycle']
  // SRC reflection uses these parameter names as wire fields, including `signal`.
  // Keep the upstream signatures explicit; rest arguments cannot cross the gateway.
  override resolveAgent(sessionId: Parameters<SessionController['resolveAgent']>[0]) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(sessionId, () => super.resolveAgent(sessionId))
  }
  override create(request: Parameters<SessionController['create']>[0]) {
    const id = request.sessionId
    return id === undefined ? super.create(request) : this.ctx.lingSessionLifecycle.withSessionOperation(id, () => super.create(request))
  }
  override prompt(request: Parameters<SessionController['prompt']>[0], signal: Parameters<SessionController['prompt']>[1]) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(request.sessionId, () => super.prompt(request, signal))
  }
  override rename(request: Parameters<SessionController['rename']>[0]) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(request.sessionId, () => super.rename(request))
  }
  override fork(request: Parameters<SessionController['fork']>[0]) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(request.sessionId, () => super.fork(request))
  }
  override selectModel(request: Parameters<SessionController['selectModel']>[0]) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(request.sessionId, () => super.selectModel(request))
  }
  override updateQueue(request: Parameters<SessionController['updateQueue']>[0]) {
    return this.ctx.lingSessionLifecycle.withSessionOperation(request.sessionId, () => super.updateQueue(request))
  }
}
export default LingSessionController
