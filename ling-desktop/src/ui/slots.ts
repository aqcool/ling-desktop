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

export const lingUiSlotKinds = {
  'sidebar.toggle.badge': 'single',
  'sidebar.brand.mark': 'single',
  'sidebar.brand.name': 'single',
  'sidebar.panellist': 'list',
  'sidebar.workspaces': 'single',
  'sidebar.settings': 'single',
  'sidebar.footer.action': 'list',
  'conversation.session.header.leading': 'single',
  'conversation.session.header.lineage': 'single',
  'conversation.session.header.actions': 'list',
  'conversation.session.header.utilities': 'list',
  'conversation.session.header.corner': 'single',
  'conversation.view': 'list',
  'conversation.hero.workspace': 'single',
  'conversation.hero.brand.mark': 'single',
  'conversation.hero.agentPreset': 'single',
  'conversation.input.left': 'list',
  'conversation.input.right': 'list',
  'conversation.input.dock': 'list',
  'conversation.input.overlay': 'list',
  'conversation.composer.dock': 'list',
  'conversation.composer.bar': 'single',
  'conversation.input.attachments': 'single',
  'conversation.input.plan': 'single',
  'conversation.input.permission': 'single',
  'conversation.input.model': 'single',
  'rightbar.session': 'single',
  'shell.overlay': 'list',
} as const satisfies Record<LingUiSlotName, 'list' | 'single'>

export type LingUiSingleSlotName = {
  [Name in LingUiSlotName]: typeof lingUiSlotKinds[Name] extends 'single' ? Name : never
}[LingUiSlotName]

export type LingUiListSlotName = {
  [Name in LingUiSlotName]: typeof lingUiSlotKinds[Name] extends 'list' ? Name : never
}[LingUiSlotName]
