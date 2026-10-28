import WebServer, { type WebRoute, type WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { updateAdmission } from './update-admission.ts'

export default class LingWebServer extends WebServer {
  override register(route: WebRoute): () => void {
    return super.register({ ...route, handler: async (request, response) => {
      if (updateAdmission.isLocked) {
        response.writeHead(503, { 'retry-after': '5', 'content-type': 'text/plain; charset=utf-8' })
        response.end('LING 正在准备更新，请稍后重试。')
        return
      }
      await updateAdmission.run(() => route.handler(request, response))
    } })
  }

  override registerUpgrade(route: WebUpgradeRoute): () => void {
    return super.registerUpgrade({ ...route, handler: (request, socket, head) => {
      if (updateAdmission.isLocked) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      return updateAdmission.run(() => route.handler(request, socket, head))
    } })
  }
}
