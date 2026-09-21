import type { ReactNode } from 'react'

export interface LingUiSlots {
  'sidebar.toggle.badge'?: ReactNode
  'sidebar.brand.mark'?: ReactNode
  'sidebar.brand.name'?: ReactNode
  'sidebar.panellist'?: readonly ReactNode[]
  'sidebar.workspaces'?: ReactNode
  'sidebar.settings'?: ReactNode
  'sidebar.footer.action'?: readonly ReactNode[]
  'conversation.session.header.leading'?: ReactNode
  'conversation.session.header.lineage'?: ReactNode
  'conversation.session.header.actions'?: readonly ReactNode[]
  'conversation.session.header.utilities'?: readonly ReactNode[]
  'conversation.session.header.corner'?: ReactNode
  'conversation.view'?: readonly ReactNode[]
  'conversation.hero.workspace'?: ReactNode
  'conversation.hero.brand.mark'?: ReactNode
  'conversation.hero.agentPreset'?: ReactNode
  'conversation.input.left'?: readonly ReactNode[]
  'conversation.input.right'?: readonly ReactNode[]
  'conversation.input.dock'?: readonly ReactNode[]
  'conversation.input.overlay'?: readonly ReactNode[]
  'conversation.composer.dock'?: readonly ReactNode[]
  'conversation.composer.bar'?: ReactNode
  'conversation.input.attachments'?: ReactNode
  'conversation.input.plan'?: ReactNode
  'conversation.input.permission'?: ReactNode
  'conversation.input.model'?: ReactNode
  'rightbar.session'?: ReactNode
  'shell.overlay'?: readonly ReactNode[]
}

export type LingUiSlotName = keyof LingUiSlots
