import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { mountLingRenderer } from 'ling-desktop/client'
import { createDshConversationProjection } from './conversation-projection.js'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    lingRenderer: unknown
  }
}

export const inject = ['sessions', 'workspaces', 'uiConversation']

function installStylesheet(): () => void {
  const existing = document.querySelector<HTMLLinkElement>('link[data-ling-renderer-styles]')
  if (existing) return () => {}
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '/ling-renderer.css'
  link.dataset.lingRendererStyles = ''
  document.head.append(link)
  return () => { link.remove() }
}

export function apply(ctx: Context): void {
  const conversation = createDshConversationProjection(ctx.uiConversation)
  ctx.effect(installStylesheet, 'LING renderer stylesheet')
  ctx.reflect.provide('uiRenderer', {
    mount: (container: HTMLElement) => mountLingRenderer(container, {
      sessions: ctx.sessions,
      workspaces: ctx.workspaces,
      conversation,
    }),
  })
}
