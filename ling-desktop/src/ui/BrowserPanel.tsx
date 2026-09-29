import type { BrowserNavigationRequest } from './browser-navigation.js'
import { useBehavior } from './behavior-preferences.js'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import {
  browserStateStorageKey,
  parseStoredBrowserNavigation,
  serializeBrowserNavigation,
  type StoredBrowserNavigation,
} from '../session-state.js'
import { Icon } from './Icon.js'
import { Menu, MenuItem } from './Menu.js'
import { tw } from './tailwind.js'
import type { LingWebviewElement } from '../browser-webview.js'

const WEB_BROWSER_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox'
const MAX_ADDRESS_LENGTH = 16384

export type BrowserTargetError = 'empty' | 'invalid' | 'protocol' | 'credentials' | 'application-origin'

export type BrowserTarget =
  | { readonly ok: true; readonly url: string; readonly title: string }
  | { readonly ok: false; readonly reason: BrowserTargetError }

export function parseBrowserTarget(input: string, applicationOrigin: string): BrowserTarget {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, reason: 'empty' }
  if (trimmed.length > MAX_ADDRESS_LENGTH) return { ok: false, reason: 'invalid' }
  const localHost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/iu.test(trimmed)
  const candidate = /^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))/u.test(trimmed) ? trimmed : `${localHost ? 'http' : 'https'}://${trimmed}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'protocol' }
  if (applicationOrigin !== '' && applicationOrigin !== 'null') {
    try {
      if (url.origin === new URL(applicationOrigin).origin) return { ok: false, reason: 'application-origin' }
    } catch {
      // An unparseable application origin cannot block a target.
    }
  }
  return { ok: true, url: url.href, title: url.hostname }
}

export function browserErrorCopy(reason: BrowserTargetError): string {
  switch (reason) {
    case 'empty':
      return '请输入地址。'
    case 'invalid':
      return '这个地址无效或过长。'
    case 'protocol':
      return '只支持 HTTP 和 HTTPS 地址；本地文件请使用文档预览。'
    case 'credentials':
      return '地址不能包含用户名或密码。'
    case 'application-origin':
      return '不能在嵌入浏览器中打开灵创应用自身。'
  }
}

export function browserTitle(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export type BrowserInteractionMode = 'browse' | 'select' | 'annotate'

export interface BrowserElementSelection {
  readonly selector: string
  readonly tagName: string
  readonly text: string
  readonly id: string
  readonly className: string
  readonly role: string
  readonly ariaLabel: string
  readonly href: string
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

export interface BrowserAnnotation {
  readonly id: number
  readonly note: string
  readonly url: string
  readonly element: BrowserElementSelection
}

interface BrowserTabState {
  readonly id: number
  readonly navigation: StoredBrowserNavigation
  readonly draft: string
  readonly failure?: BrowserTargetError
  readonly revision: number
  readonly loading: boolean
  readonly loadFailed: boolean
  readonly mode: BrowserInteractionMode
  readonly selection?: BrowserElementSelection
  readonly annotationDraft: string
  readonly annotations: readonly BrowserAnnotation[]
  readonly guestReady: boolean
  readonly pageTitle?: string
}

interface BrowserPanelProps {
  readonly onNavigationHandled?: (id: string) => void
  readonly navigationRequest?: BrowserNavigationRequest
  readonly active: boolean
  readonly applicationOrigin: string
  readonly annotationResetKey?: number
  readonly onAnnotationsChange?: (annotations: readonly BrowserAnnotation[]) => void
  readonly onSendAnnotations?: (annotations: readonly BrowserAnnotation[]) => void
}

function createBrowserTab(id: number, navigation: StoredBrowserNavigation = { entries: [], index: -1 }): BrowserTabState {
  return {
    id,
    navigation,
    draft: navigation.entries[navigation.index] ?? '',
    revision: 0,
    loading: false,
    loadFailed: false,
    mode: 'browse',
    annotationDraft: '',
    annotations: [],
    guestReady: false,
  }
}

function clippedString(value: unknown, length: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, length) : undefined
}

export function parseBrowserElementSelection(value: unknown): BrowserElementSelection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const selector = clippedString(candidate.selector, 1024)
  const tagName = clippedString(candidate.tagName, 64)
  const rect = candidate.rect
  if (!selector || !tagName || !rect || typeof rect !== 'object') return undefined
  const values = rect as Record<string, unknown>
  const coordinates = [values.x, values.y, values.width, values.height]
  if (!coordinates.every(item => typeof item === 'number' && Number.isFinite(item))) return undefined
  return {
    selector,
    tagName,
    text: clippedString(candidate.text, 240) ?? '',
    id: clippedString(candidate.id, 256) ?? '',
    className: clippedString(candidate.className, 512) ?? '',
    role: clippedString(candidate.role, 128) ?? '',
    ariaLabel: clippedString(candidate.ariaLabel, 256) ?? '',
    href: clippedString(candidate.href, 2048) ?? '',
    rect: {
      x: values.x as number,
      y: values.y as number,
      width: values.width as number,
      height: values.height as number,
    },
  }
}

function isHttpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

function isNativeBrowserAvailable(): boolean {
  return Object.prototype.hasOwnProperty.call(window, 'dshDesktop')
}

function annotationMarkers(annotations: readonly BrowserAnnotation[], url: string | undefined) {
  return annotations.filter(annotation => annotation.url === url).map((annotation, index) => ({
    selector: annotation.element.selector,
    label: index + 1,
  }))
}

function pageHost(url: string | undefined): string {
  if (!url) return ''
  try { return new URL(url).hostname } catch { return '' }
}

export function BrowserPanel({
  navigationRequest,
  onNavigationHandled,
  active,
  applicationOrigin,
  annotationResetKey = 0,
  onAnnotationsChange,
  onSendAnnotations,
}: BrowserPanelProps) {
  const behavior = useBehavior()
  const showLocalServices = behavior.modes[behavior.workMode].localServices
  const [tabs, setTabs] = useState<BrowserTabState[]>(() => [createBrowserTab(1, parseStoredBrowserNavigation(window.localStorage.getItem(browserStateStorageKey)))])
  const [activeId, setActiveId] = useState(1)
  const [copyNotice, setCopyNotice] = useState<string>()
  const nextId = useRef(2)
  const handledNavigation = useRef<string | undefined>(undefined)
  const nextAnnotationId = useRef(1)
  const previousResetKey = useRef(annotationResetKey)
  const addressRef = useRef<HTMLInputElement>(null)
  const commentRef = useRef<HTMLInputElement>(null)
  const webviewRef = useRef<LingWebviewElement>(null)
  const frameHostRef = useRef<HTMLDivElement>(null)
  const nativeBrowser = isNativeBrowserAvailable()
  const activeTab = tabs.find(tab => tab.id === activeId) ?? tabs[0] ?? createBrowserTab(0)
  const navigation = activeTab.navigation
  const current = navigation.entries[navigation.index]
  const allAnnotations = tabs.flatMap(tab => tab.annotations)
  const currentAnnotations = activeTab.annotations.filter(annotation => annotation.url === current)

  const updateTab = (id: number, update: (tab: BrowserTabState) => BrowserTabState) => {
    setTabs(existing => existing.map(tab => tab.id === id ? update(tab) : tab))
  }

  const addTab = () => {
    const id = nextId.current++
    setTabs(existing => [...existing, createBrowserTab(id)])
    setActiveId(id)
    window.requestAnimationFrame(() => { addressRef.current?.focus() })
  }

  const closeTab = (id: number) => {
    if (tabs.length === 1) {
      const replacement = createBrowserTab(nextId.current++)
      setTabs([replacement])
      setActiveId(replacement.id)
      return
    }
    const index = tabs.findIndex(tab => tab.id === id)
    const remaining = tabs.filter(tab => tab.id !== id)
    setTabs(remaining)
    if (activeId === id) setActiveId(remaining[Math.max(0, index - 1)]?.id ?? remaining[0]!.id)
  }

  useEffect(() => {
    window.localStorage.setItem(browserStateStorageKey, serializeBrowserNavigation(navigation))
  }, [navigation])

  useEffect(() => { onAnnotationsChange?.(allAnnotations) }, [tabs])

  useEffect(() => {
    if (previousResetKey.current === annotationResetKey) return
    previousResetKey.current = annotationResetKey
    setTabs(existing => existing.map(tab => ({ ...tab, annotations: [], selection: undefined, annotationDraft: '', mode: 'browse' })))
    if (activeTab.guestReady) webviewRef.current?.send('ling-browser-command', { type: 'clear-selection' })
  }, [annotationResetKey])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        addTab()
      } else if (event.key.toLowerCase() === 'l') {
        event.preventDefault()
        addressRef.current?.focus()
        addressRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [active])

  useEffect(() => {
    if (!nativeBrowser || current === undefined) return
    const guest = webviewRef.current
    if (!guest) return
    const sendState = () => {
      guest.send('ling-browser-command', { type: 'set-mode', mode: activeTab.mode })
      guest.send('ling-browser-command', { type: 'set-annotations', markers: annotationMarkers(activeTab.annotations, current) })
    }
    const onReady = () => {
      updateTab(activeId, tab => ({ ...tab, guestReady: true, loading: false, loadFailed: false }))
      sendState()
    }
    const onIpcMessage = (event: Event) => {
      const message = event as Event & { readonly channel?: unknown; readonly args?: readonly unknown[] }
      if (message.channel === 'ling-browser-ready') {
        onReady()
        return
      }
      if (message.channel !== 'ling-browser-element-selected') return
      const payload = message.args?.[0]
      if (!payload || typeof payload !== 'object') return
      const element = parseBrowserElementSelection((payload as { readonly element?: unknown }).element)
      if (!element) return
      updateTab(activeId, tab => ({ ...tab, selection: element }))
      window.requestAnimationFrame(() => { commentRef.current?.focus() })
    }
    const onNavigate = (event: Event) => {
      const url = (event as Event & { readonly url?: unknown }).url
      if (typeof url !== 'string' || !isHttpUrl(url)) return
      updateTab(activeId, tab => {
        const existing = tab.navigation.entries[tab.navigation.index]
        if (existing === url) return { ...tab, draft: url, loading: false, loadFailed: false, selection: undefined }
        const entries = [...tab.navigation.entries.slice(0, tab.navigation.index + 1), url]
        return {
          ...tab,
          navigation: { entries, index: entries.length - 1 },
          draft: url,
          loading: false,
          loadFailed: false,
          selection: undefined,
          pageTitle: undefined,
        }
      })
    }
    const onTitle = (event: Event) => {
      const title = (event as Event & { readonly title?: unknown }).title
      if (typeof title === 'string' && title.trim()) updateTab(activeId, tab => ({ ...tab, pageTitle: title.trim().slice(0, 160) }))
    }
    const onStart = () => { updateTab(activeId, tab => ({ ...tab, loading: true, loadFailed: false, guestReady: false })) }
    const onStop = () => { updateTab(activeId, tab => ({ ...tab, loading: false })) }
    const onFail = (event: Event) => {
      const code = (event as Event & { readonly errorCode?: unknown }).errorCode
      if (code === -3) return
      updateTab(activeId, tab => ({ ...tab, loading: false, loadFailed: true }))
    }
    guest.addEventListener('dom-ready', onReady)
    guest.addEventListener('ipc-message', onIpcMessage)
    guest.addEventListener('did-navigate', onNavigate)
    guest.addEventListener('did-navigate-in-page', onNavigate)
    guest.addEventListener('page-title-updated', onTitle)
    guest.addEventListener('did-start-loading', onStart)
    guest.addEventListener('did-stop-loading', onStop)
    guest.addEventListener('did-fail-load', onFail)
    return () => {
      guest.removeEventListener('dom-ready', onReady)
      guest.removeEventListener('ipc-message', onIpcMessage)
      guest.removeEventListener('did-navigate', onNavigate)
      guest.removeEventListener('did-navigate-in-page', onNavigate)
      guest.removeEventListener('page-title-updated', onTitle)
      guest.removeEventListener('did-start-loading', onStart)
      guest.removeEventListener('did-stop-loading', onStop)
      guest.removeEventListener('did-fail-load', onFail)
    }
  }, [activeId, activeTab.revision, current, nativeBrowser])

  useEffect(() => {
    if (!nativeBrowser || !activeTab.guestReady || current === undefined) return
    webviewRef.current?.send('ling-browser-command', { type: 'set-mode', mode: activeTab.mode })
    webviewRef.current?.send('ling-browser-command', {
      type: 'set-annotations',
      markers: annotationMarkers(activeTab.annotations, current),
    })
  }, [activeTab.annotations, activeTab.guestReady, activeTab.mode, current, nativeBrowser])

  const canGoBack = navigation.index > 0
  const canGoForward = navigation.index >= 0 && navigation.index < navigation.entries.length - 1

  const load = (next: StoredBrowserNavigation) => {
    updateTab(activeId, tab => ({
      ...tab,
      navigation: next,
      draft: next.entries[next.index] ?? '',
      failure: undefined,
      loading: true,
      loadFailed: false,
      guestReady: false,
      selection: undefined,
      pageTitle: undefined,
      revision: tab.revision + 1,
    }))
  }

  const openUrl = (url: string) => {
    const entries = [...navigation.entries.slice(0, navigation.index + 1), url]
    load({ entries, index: entries.length - 1 })
  }

  useEffect(() => {
    if (!navigationRequest || handledNavigation.current === navigationRequest.id) return
    handledNavigation.current = navigationRequest.id
    onNavigationHandled?.(navigationRequest.id)
    const target = parseBrowserTarget(navigationRequest.url, applicationOrigin)
    if (!target.ok) { setCopyNotice(browserErrorCopy(target.reason)); return }
    const id = nextId.current++
    setTabs(current => [...current, createBrowserTab(id, { entries: [target.url], index: 0 })])
    setActiveId(id)
  }, [navigationRequest?.id, applicationOrigin])

  const submit = () => {
    const target = parseBrowserTarget(activeTab.draft, applicationOrigin)
    if (!target.ok) {
      updateTab(activeId, tab => ({ ...tab, failure: target.reason }))
      return
    }
    openUrl(target.url)
  }

  const enterAnnotationMode = () => {
    updateTab(activeId, tab => ({ ...tab, mode: 'annotate', selection: undefined, annotationDraft: '' }))
  }

  const exitAnnotationMode = () => {
    updateTab(activeId, tab => ({ ...tab, mode: 'browse', selection: undefined, annotationDraft: '' }))
    webviewRef.current?.send('ling-browser-command', { type: 'clear-selection' })
  }

  const saveAnnotation = () => {
    const note = activeTab.annotationDraft.trim()
    if (!activeTab.selection || !current || note === '') return
    const annotation: BrowserAnnotation = {
      id: nextAnnotationId.current++,
      note: note.slice(0, 1000),
      url: current,
      element: activeTab.selection,
    }
    updateTab(activeId, tab => ({
      ...tab,
      annotations: [...tab.annotations, annotation],
      annotationDraft: '',
      selection: undefined,
    }))
    webviewRef.current?.send('ling-browser-command', { type: 'clear-selection' })
  }

  const clearCurrentAnnotations = () => {
    updateTab(activeId, tab => ({
      ...tab,
      annotations: tab.annotations.filter(annotation => annotation.url !== current),
      selection: undefined,
      annotationDraft: '',
    }))
    webviewRef.current?.send('ling-browser-command', { type: 'clear-selection' })
  }

  const copyLink = async () => {
    if (!current) return
    await navigator.clipboard.writeText(current)
    setCopyNotice('链接已复制')
    window.setTimeout(() => { setCopyNotice(undefined) }, 1400)
  }

  const copyScreenshot = async () => {
    try {
      const image = await webviewRef.current?.capturePage()
      if (!image) return
      const blob = await (await fetch(image.toDataURL())).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopyNotice('截图已复制')
    } catch {
      setCopyNotice('无法复制截图')
    }
    window.setTimeout(() => { setCopyNotice(undefined) }, 1400)
  }

  const sendAnnotations = () => {
    if (allAnnotations.length === 0) return
    onSendAnnotations?.(allAnnotations)
  }

  const iconButton = 'grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent'
  const localTargets = Array.from(new Map([
    ['http://localhost:5173/', { url: 'http://localhost:5173/', title: '灵创', detail: 'ling-desktop' }],
    ...tabs.flatMap(tab => tab.navigation.entries).filter(url => {
      try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname) } catch { return false }
    }).map(url => [url, { url, title: tabs.find(tab => tab.navigation.entries.includes(url))?.pageTitle ?? '本地服务', detail: 'ling-desktop' }] as const),
  ]).values())
  const editorTop = activeTab.selection
    ? Math.min(activeTab.selection.rect.y + activeTab.selection.rect.height + 12, Math.max(12, (frameHostRef.current?.clientHeight ?? 480) - 66))
    : 12
  const editorLeft = activeTab.selection
    ? Math.max(12, Math.min(activeTab.selection.rect.x, Math.max(12, (frameHostRef.current?.clientWidth ?? 360) - 332)))
    : 12

  return (
    <section aria-label="内置浏览器" className={tw('relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface)]')}>
      {activeTab.mode === 'annotate' ? (
        <div className={tw('flex h-10 shrink-0 items-center gap-1 bg-[#eaf7fd] px-2.5 dark:bg-[#1d3440]')}>
          <button aria-label="结束注释" className={tw(iconButton)} onClick={exitAnnotationMode} type="button"><Icon name="close" size={16} /></button>
          <button aria-label="清空当前页面批注" className={tw(iconButton)} disabled={currentAnnotations.length === 0} onClick={clearCurrentAnnotations} type="button"><Icon name="trash" size={16} /></button>
          <strong className={tw('min-w-0 flex-1 overflow-hidden text-center text-sm font-medium text-[var(--foreground)] text-ellipsis whitespace-nowrap')}>正在批注 · {pageHost(current)}</strong>
          <button aria-label="复制截图" className={tw(iconButton)} disabled={!current || !nativeBrowser} onClick={() => { void copyScreenshot() }} type="button"><Icon name="camera" size={16} /></button>
          <Button className={tw('h-8 min-w-14 rounded-lg bg-[#4e7d68] px-3 text-xs font-semibold text-white disabled:opacity-45')} isDisabled={allAnnotations.length === 0} onPress={sendAnnotations} size="sm">发送</Button>
        </div>
      ) : (
        <form className={tw('flex h-10 shrink-0 items-center gap-1 px-2.5')} onSubmit={event => { event.preventDefault(); submit() }}>
          <button aria-label="后退" className={tw(iconButton)} disabled={!canGoBack} onClick={() => { load({ ...navigation, index: navigation.index - 1 }) }} type="button"><Icon name="back" size={16} /></button>
          <button aria-label="前进" className={tw(iconButton)} disabled={!canGoForward} onClick={() => { load({ ...navigation, index: navigation.index + 1 }) }} type="button"><Icon name="forward" size={16} /></button>
          <button aria-label="重新加载" className={tw(iconButton)} disabled={!current} onClick={() => { load(navigation) }} type="button"><Icon name="refresh" size={16} /></button>
          <label className={tw('relative flex h-8 min-w-0 flex-1 items-center')}>
            <span className={tw('pointer-events-none absolute left-2.5 text-[var(--muted)]')}><Icon name="globe" size={15} /></span>
            <input aria-label="网页地址" className={tw('h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--field-background)] pr-2.5 pl-8 text-xs text-[var(--field-foreground)] outline-none placeholder:text-[var(--field-placeholder)] focus:border-[var(--focus)] dark:border-[#3c3c41] dark:bg-[#232327]')} onChange={event => { updateTab(activeId, tab => ({ ...tab, draft: event.target.value, failure: undefined })) }} placeholder="输入网址，例如 localhost:3000" ref={addressRef} value={activeTab.draft} />
          </label>
          <button aria-label="注释" aria-pressed="false" className={tw(iconButton)} disabled={!nativeBrowser || !current} onClick={enterAnnotationMode} type="button"><Icon name="annotation" size={16} /></button>
          <button aria-label="复制截图" className={tw(iconButton)} disabled={!nativeBrowser || !current} onClick={() => { void copyScreenshot() }} type="button"><Icon name="camera" size={16} /></button>
          <button aria-label="复制链接" className={tw(iconButton)} disabled={!current} onClick={() => { void copyLink() }} type="button"><Icon name="link" size={16} /></button>
          <Menu align="end" triggerAriaLabel="更多浏览器操作" triggerClassName="size-7 shrink-0 rounded-md hover:bg-[var(--surface-hover)]" triggerLabel={<Icon name="more" size={16} />}>
            <MenuItem icon="plus" onPress={addTab}>新标签页</MenuItem>
            <MenuItem disabled={!nativeBrowser || !current} icon="camera" onPress={() => { void copyScreenshot() }}>复制截图</MenuItem>
            <MenuItem disabled={!current} icon="external" onPress={() => { if (current) window.open(current, '_blank', 'noopener,noreferrer') }}>在外部浏览器中打开</MenuItem>
          </Menu>
        </form>
      )}

      <div className={tw('flex h-9 shrink-0 items-center gap-1 overflow-x-auto px-2.5 pb-1')} role="tablist" aria-label="当前类型标签页">
        {tabs.map(tab => {
          const url = tab.navigation.entries[tab.navigation.index]
          const title = tab.pageTitle ?? (url ? browserTitle(url) : '新标签页')
          return (
            <div className={tw('inline-flex h-7 max-w-44 shrink-0 items-center gap-0.5 rounded-md px-1 text-xs text-[var(--text-secondary)]', tab.id === activeId && 'bg-[var(--surface-tertiary)] text-[var(--foreground)]')} key={tab.id}>
              <button aria-selected={tab.id === activeId} className={tw('flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden border-0 bg-transparent px-1.5 text-inherit')} onClick={() => { setActiveId(tab.id) }} role="tab" type="button"><Icon name="globe" size={14} /><span className={tw('overflow-hidden text-ellipsis whitespace-nowrap')}>{title}</span></button>
              <button aria-label={`关闭 ${title} 标签页`} className={tw('grid size-5 shrink-0 place-items-center rounded-sm border-0 bg-transparent p-0 text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]')} onClick={() => { closeTab(tab.id) }} type="button"><Icon name="close" size={11} /></button>
            </div>
          )
        })}
      </div>

      {activeTab.failure !== undefined ? <p className={tw('m-0 px-3 py-1.5 text-[0.72rem] leading-5 text-[#b04c43] dark:text-[#d8837a]')} role="alert">{browserErrorCopy(activeTab.failure)}</p> : null}
      {activeTab.loading ? <p className={tw('m-0 px-3 py-1 text-[0.7rem] leading-5 text-[var(--muted)]')}>正在打开…</p> : null}
      {activeTab.loadFailed ? <p className={tw('m-0 px-3 py-1 text-[0.7rem] leading-5 text-[var(--muted)]')}>页面加载失败；请检查地址或在外部浏览器中打开。</p> : null}
      {copyNotice ? <div className={tw('pointer-events-none absolute right-4 bottom-4 z-30 rounded-lg bg-[#252525] px-3 py-2 text-xs text-white shadow-lg')}>{copyNotice}</div> : null}

      {current === undefined ? (showLocalServices ? (
        <div className={tw('min-h-0 flex-1 overflow-auto px-5 py-5')}>
          <div className={tw('mb-3 flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]')}><span>Local</span><button aria-label="刷新本地服务" className={tw(iconButton)} type="button"><Icon name="refresh" size={15} /></button></div>
          <div className={tw('grid gap-1')}>
            {localTargets.map(target => (
              <button className={tw('flex min-w-0 items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-2 text-left hover:bg-[var(--surface-hover)]')} key={target.url} onClick={() => { openUrl(target.url) }} type="button">
                <span className={tw('grid size-7 shrink-0 place-items-center rounded-md bg-[var(--surface-tertiary)] text-[var(--text-secondary)]')}><Icon name="globe" size={16} /></span>
                <span className={tw('min-w-0 flex-1')}><strong className={tw('block overflow-hidden text-sm font-medium text-[var(--foreground)] text-ellipsis whitespace-nowrap')}>{target.title}</strong><small className={tw('block overflow-hidden text-[0.68rem] text-[var(--muted)] text-ellipsis whitespace-nowrap')}>{new URL(target.url).host}</small></span>
                <small className={tw('shrink-0 text-[0.68rem] text-[var(--muted)]')}>{target.detail}</small>
              </button>
            ))}
          </div>
        </div>
      ) : <div className={tw('flex min-h-0 flex-1 items-center justify-center text-xs text-[var(--text-tertiary)]')}>输入网址开始浏览</div>) : (
        <div className={tw('relative flex min-h-0 flex-1 overflow-hidden')} ref={frameHostRef}>
          {nativeBrowser ? (
            <webview className={tw('h-full min-h-0 w-full flex-1 bg-white')} data-ling-browser-frame="true" key={`${String(activeId)}:${String(activeTab.revision)}`} partition="persist:ling-browser" ref={webviewRef} src={current} />
          ) : (
            <iframe className={tw('h-full min-h-0 w-full flex-1 border-0 bg-white')} data-ling-browser-frame="true" key={`${String(activeId)}:${current}:${String(activeTab.revision)}`} onError={() => { updateTab(activeId, tab => ({ ...tab, loading: false, loadFailed: true })) }} onLoad={() => { updateTab(activeId, tab => ({ ...tab, loading: false })) }} referrerPolicy="no-referrer" sandbox={WEB_BROWSER_SANDBOX} src={current} title={browserTitle(current)} />
          )}
          {activeTab.mode === 'annotate' && activeTab.selection ? (
            <div className={tw('absolute z-20 flex h-12 w-[min(20rem,calc(100%_-_1.5rem))] items-center gap-1.5 rounded-2xl border border-black/5 bg-white px-2.5 shadow-[0_12px_30px_rgb(0_0_0_/_0.16)] dark:border-white/10 dark:bg-[#26262a]')} style={{ left: `${String(editorLeft)}px`, top: `${String(editorTop)}px` }}>
              <input aria-label="网页注释评论" className={tw('h-full min-w-0 flex-1 border-0 bg-transparent px-1 text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]')} maxLength={1000} onChange={event => { updateTab(activeId, tab => ({ ...tab, annotationDraft: event.target.value })) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveAnnotation() } }} placeholder="添加评论…" ref={commentRef} value={activeTab.annotationDraft} />
              <button aria-label="调整选择" className={tw(iconButton)} title={`${activeTab.selection.tagName} · ${activeTab.selection.selector}`} type="button"><Icon name="target" size={15} /></button>
              <button aria-label="语音输入" className={tw(iconButton)} disabled title="语音输入尚未接入" type="button"><Icon name="mic" size={16} /></button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
