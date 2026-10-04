export const browserNavigationEvent = 'ling:open-browser-url'
export interface BrowserNavigationRequest { readonly id: string; readonly url: string }
export function requestBrowserNavigation(url: string): void {
  window.dispatchEvent(new CustomEvent(browserNavigationEvent, { detail: { id: crypto.randomUUID(), url } satisfies BrowserNavigationRequest }))
}
