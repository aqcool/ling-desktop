import type { ReactNode } from 'react'

export interface LingUiSlots {
  'sidebar.panellist'?: readonly ReactNode[]
  'sidebar.footer.action'?: readonly ReactNode[]
  'rightbar.session'?: ReactNode
  'shell.overlay'?: readonly ReactNode[]
}

export type LingUiSlotName = keyof LingUiSlots

export const lingUiSlotKinds = {
  'sidebar.panellist': 'list',
  'sidebar.footer.action': 'list',
  'rightbar.session': 'single',
  'shell.overlay': 'list',
} as const satisfies Record<LingUiSlotName, 'list' | 'single'>

export type LingUiSingleSlotName = {
  [Name in LingUiSlotName]: typeof lingUiSlotKinds[Name] extends 'single' ? Name : never
}[LingUiSlotName]

export type LingUiListSlotName = {
  [Name in LingUiSlotName]: typeof lingUiSlotKinds[Name] extends 'list' ? Name : never
}[LingUiSlotName]
