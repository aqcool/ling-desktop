import type { HTMLAttributes, Ref } from 'react'

export interface LingWebviewElement extends HTMLElement {
  capturePage(): Promise<{ toDataURL(): string }>
  getURL(): string
  reload(): void
  send(channel: string, ...args: unknown[]): void
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: HTMLAttributes<LingWebviewElement> & {
        readonly partition?: string
        readonly ref?: Ref<LingWebviewElement>
        readonly src?: string
      }
    }
  }
}
