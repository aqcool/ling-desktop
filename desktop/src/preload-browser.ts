import { ipcRenderer } from 'electron'

type BrowserInteractionMode = 'browse' | 'select' | 'annotate'

interface BrowserAnnotationMarker {
  readonly selector: string
  readonly label: number
}

let mode: BrowserInteractionMode = 'browse'
let selectedSelector: string | undefined
let highlight: HTMLDivElement | undefined
let cursorStyle: HTMLStyleElement | undefined
let markerLayer: HTMLDivElement | undefined
let markers: readonly BrowserAnnotationMarker[] = []

function overlayRoot(): HTMLElement {
  return document.body ?? document.documentElement
}

function ensureHighlight(): HTMLDivElement {
  if (highlight?.isConnected) return highlight
  highlight = document.createElement('div')
  highlight.dataset.lingBrowserOverlay = 'highlight'
  Object.assign(highlight.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #c96343', borderRadius: '4px',
    background: 'rgb(201 99 67 / 0.10)', boxShadow: '0 0 0 1px rgb(255 255 255 / 0.75)',
    display: 'none',
  })
  overlayRoot().append(highlight)
  return highlight
}

function ensureMarkerLayer(): HTMLDivElement {
  if (markerLayer?.isConnected) return markerLayer
  markerLayer = document.createElement('div')
  markerLayer.dataset.lingBrowserOverlay = 'annotations'
  Object.assign(markerLayer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647' })
  overlayRoot().append(markerLayer)
  return markerLayer
}

function isOverlay(element: Element): boolean {
  return element.closest('[data-ling-browser-overlay]') !== null
}

function targetElement(event: Event): Element | undefined {
  const candidate = event.composedPath()[0]
  if (candidate instanceof Element && !isOverlay(candidate)) return candidate
  if (candidate instanceof Node && candidate.parentElement && !isOverlay(candidate.parentElement)) return candidate.parentElement
  return undefined
}

function positionHighlight(element?: Element, selected = false): void {
  const frame = ensureHighlight()
  if (!element || !element.isConnected) {
    frame.style.display = 'none'
    return
  }
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    frame.style.display = 'none'
    return
  }
  Object.assign(frame.style, {
    display: 'block', left: `${String(rect.left)}px`, top: `${String(rect.top)}px`,
    width: `${String(rect.width)}px`, height: `${String(rect.height)}px`,
    borderColor: selected ? '#3b82f6' : '#8b8f94',
    background: selected ? 'rgb(59 130 246 / 0.08)' : 'rgb(80 80 80 / 0.06)',
  })
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/gu, character => `\\${character}`)
}

function selectorFor(element: Element): string {
  if (element.id && document.querySelectorAll(`#${cssEscape(element.id)}`).length === 1) return `#${cssEscape(element.id)}`
  const testId = element.getAttribute('data-testid')
  if (testId) {
    const selector = `[data-testid="${cssEscape(testId)}"]`
    try { if (document.querySelectorAll(selector).length === 1) return selector } catch {}
  }
  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase()
    const parent: Element | null = current.parentElement
    if (!parent) { parts.unshift(tag); break }
    const siblings = [...parent.children].filter(sibling => sibling.tagName === current!.tagName)
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${String(siblings.indexOf(current) + 1)})` : tag)
    const candidate = parts.join(' > ')
    try { if (document.querySelectorAll(candidate).length === 1) return candidate } catch {}
    current = parent
  }
  return parts.join(' > ')
}

function elementDescription(element: Element) {
  const rect = element.getBoundingClientRect()
  const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 240)
  return {
    selector: selectorFor(element).slice(0, 1024),
    tagName: element.tagName.toLowerCase().slice(0, 64),
    text,
    id: element.id.slice(0, 256),
    className: typeof element.className === 'string' ? element.className.slice(0, 512) : '',
    role: (element.getAttribute('role') ?? '').slice(0, 128),
    ariaLabel: (element.getAttribute('aria-label') ?? '').slice(0, 256),
    href: element instanceof HTMLAnchorElement ? element.href.slice(0, 2048) : '',
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  }
}

function onPointerMove(event: MouseEvent): void {
  if (mode === 'browse') return
  positionHighlight(targetElement(event))
}

function onPageClick(event: MouseEvent): void {
  if (mode === 'browse') return
  const element = targetElement(event)
  if (!element) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  selectedSelector = selectorFor(element)
  positionHighlight(element, true)
  ipcRenderer.sendToHost('ling-browser-element-selected', { mode, element: elementDescription(element) })
}

function setMode(next: BrowserInteractionMode): void {
  mode = next
  if (mode === 'browse') {
    cursorStyle?.remove()
    cursorStyle = undefined
    if (!selectedSelector) positionHighlight()
    return
  }
  if (!cursorStyle?.isConnected) {
    cursorStyle = document.createElement('style')
    cursorStyle.dataset.lingBrowserOverlay = 'cursor'
    cursorStyle.textContent = '* { cursor: crosshair !important; }'
    overlayRoot().append(cursorStyle)
  }
}

function clearSelection(): void {
  selectedSelector = undefined
  positionHighlight()
}

function renderMarkers(): void {
  const layer = ensureMarkerLayer()
  layer.replaceChildren()
  for (const marker of markers) {
    let element: Element | null = null
    try { element = document.querySelector(marker.selector) } catch {}
    if (!element) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const badge = document.createElement('span')
    badge.textContent = String(marker.label)
    Object.assign(badge.style, {
      position: 'fixed', left: `${String(Math.max(2, rect.right - 11))}px`, top: `${String(Math.max(2, rect.top - 11))}px`,
      display: 'grid', placeItems: 'center', width: '22px', height: '22px', borderRadius: '999px',
      background: '#3b82f6', color: '#fff', font: '600 12px/1 system-ui, sans-serif',
      boxShadow: '0 2px 8px rgb(0 0 0 / 0.25)',
    })
    layer.append(badge)
  }
}

function focusSelector(selector: string): void {
  let element: Element | null = null
  try { element = document.querySelector(selector) } catch {}
  if (!element) return
  selectedSelector = selector
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  positionHighlight(element, true)
}

document.addEventListener('mousemove', onPointerMove, true)
document.addEventListener('click', onPageClick, true)
window.addEventListener('scroll', () => {
  if (selectedSelector) {
    try { positionHighlight(document.querySelector(selectedSelector) ?? undefined, true) } catch { positionHighlight() }
  }
  renderMarkers()
}, true)
window.addEventListener('resize', renderMarkers)

ipcRenderer.on('ling-browser-command', (_event, command: unknown) => {
  if (!command || typeof command !== 'object') return
  const value = command as { readonly type?: unknown; readonly mode?: unknown; readonly selector?: unknown; readonly markers?: unknown }
  if (value.type === 'set-mode' && ['browse', 'select', 'annotate'].includes(String(value.mode))) setMode(value.mode as BrowserInteractionMode)
  if (value.type === 'clear-selection') clearSelection()
  if (value.type === 'focus-selector' && typeof value.selector === 'string') focusSelector(value.selector.slice(0, 1024))
  if (value.type === 'set-annotations' && Array.isArray(value.markers)) {
    markers = value.markers.flatMap(marker => {
      if (!marker || typeof marker !== 'object') return []
      const candidate = marker as { readonly selector?: unknown; readonly label?: unknown }
      return typeof candidate.selector === 'string' && typeof candidate.label === 'number'
        ? [{ selector: candidate.selector.slice(0, 1024), label: candidate.label }]
        : []
    }).slice(0, 200)
    renderMarkers()
  }
})

window.addEventListener('DOMContentLoaded', () => {
  setMode(mode)
  renderMarkers()
  ipcRenderer.sendToHost('ling-browser-ready')
})
