import { CommandType, ICommandService, LocaleService, LocaleType, ThemeService, UniverInstanceType } from '@univerjs/core'
import { createUniver } from '@univerjs/presets'
import type { IDisposable } from '@univerjs/core'
import { readOfficePreview } from './preview.js'
import { OFFICE_MAX_BYTES } from './ooxml.js'

export interface OfficeViewer { dispose(): void; warnings: string[] }

/** No save callback, network exchange, or Pro plugins are exposed to this viewer. */
export async function mountOfficeViewer(container: HTMLElement, path: string, data: string, signal: AbortSignal): Promise<OfficeViewer | undefined> {
  if (signal.aborted) return
  if (data.length > Math.ceil(OFFICE_MAX_BYTES / 3) * 4) throw new Error('文件超过 16 MB，无法预览。')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(data), value => value.charCodeAt(0)) } catch { throw new Error('文档内容无效，无法预览。') }
  const preview = await readOfficePreview(path, bytes)
  if (signal.aborted) return
  const common = { container, header: false, toolbar: false, contextMenu: false, disableAutoFocus: true } as const
  const configuration = preview.kind === 'sheet'
    ? await import('@univerjs/preset-sheets-core').then(async module => ({
      presets: [module.UniverSheetsCorePreset({ ...common, formulaBar: false, formula: { initialFormulaComputing: module.CalculationMode.NO_CALCULATION }, footer: { sheetBar: true, statisticBar: false, menus: false, addSheetButtonConfig: { show: false } } })],
      locales: { [LocaleType.ZH_CN]: (await import('@univerjs/preset-sheets-core/locales/zh-CN')).default },
    }))
    : await import('@univerjs/preset-docs-core').then(async module => {
      const preset = module.UniverDocsCorePreset({ ...common, footer: false })
      if (preview.kind === 'document') preset.plugins = preset.plugins.map(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === module.UniverDocsUIPlugin
        ? [module.UniverDocsUIPlugin, { container, footer: false, fitToWidth: { mode: 'fit-width', paddingX: 16, minScale: 0.2, maxScale: 1 } }]
        : plugin)
      const drawing = preview.kind === 'document' ? await import('@univerjs/preset-docs-drawing') : undefined
      const drawingLocale = drawing ? (await import('@univerjs/preset-docs-drawing/locales/zh-CN')).default : {}
      return { presets: [preset, ...(drawing ? [drawing.UniverDocsDrawingPreset()] : [])], locales: { [LocaleType.ZH_CN]: { ...(await import('@univerjs/preset-docs-core/locales/zh-CN')).default, ...drawingLocale } } }
    })
  if (signal.aborted) return
  const { IRenderManagerService, DocPageLayoutService } = await import('@univerjs/preset-docs-core')
  if (signal.aborted) return
  const { univer, univerAPI } = createUniver({ ...configuration, locale: LocaleType.ZH_CN, logCommandExecution: false })
  let disposed = false
  let frame = 0
  let readyFrame = 0
  let finishReady: (() => void) | undefined
  let slideViewport = ''
  const slideViewCommands = new Set<string>()
  const subscriptions: IDisposable[] = []
  container.dataset.officeKind = preview.kind
  const observer = new MutationObserver(() => univer.__getInjector().get(ThemeService).setDarkMode(document.documentElement.dataset.theme === 'dark'))
  const refresh = () => {
    if (disposed) return
    const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(preview.data.id)
    if (render) {
      render.engine.resize()
      if (preview.kind === 'document') render.with(DocPageLayoutService).calculatePagePosition()
      if (preview.kind === 'slides' && render.unitId === preview.data.id && render.mainComponent) {
        const width = preview.data.pageSize.width ?? 960, height = preview.data.pageSize.height ?? 540
        const scale = Math.max(0.1, Math.min(1, (render.engine.width - 32) / width))
        render.scene.scale(scale, scale)
        render.scene.transformByState({ width: width + 32 / scale, height: Math.max(height + 32 / scale, render.engine.height / scale) })
        render.mainComponent.translate(16 / scale, 16 / scale)
        render.scene.getViewport(slideViewport)?.scrollToViewportPos({ viewportScrollX: 0, viewportScrollY: 0 })
      }
      render.mainComponent?.makeDirty()
    }
  }
  const resize = new ResizeObserver(refresh)
  const preventSlideEditing = (event: Event) => {
    const target = event.target as HTMLElement
    if (preview.kind === 'slides' && target.closest('canvas') && !target.closest('[data-u-comp="left-sidebar"]')) { event.preventDefault(); event.stopImmediatePropagation() }
  }
  const dispose = () => { if (disposed) return; disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(readyFrame); finishReady?.(); subscriptions.forEach(subscription => subscription.dispose()); observer.disconnect(); resize.disconnect(); for (const type of ['pointerdown', 'mousedown', 'dblclick']) container.removeEventListener(type, preventSlideEditing, true); univer.dispose() }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    if (preview.kind === 'sheet') {
      const workbook = univerAPI.createWorkbook(preview.data)
      await workbook.getWorkbookPermission().setReadOnly()
    } else if (preview.kind === 'document') {
      const { DOCS_DRAWING_PLUGIN } = await import('@univerjs/preset-docs-drawing')
      if (signal.aborted) { dispose(); return }
      // The drawing plugin restores its own resource during unit creation.
      const doc = univerAPI.createDocument({ ...preview.data, resources: [{ name: DOCS_DRAWING_PLUGIN, data: JSON.stringify({ data: preview.data.drawings ?? {}, order: preview.data.drawingsOrder ?? [] }) }] })
      await doc.getPermission().setReadOnly()
    } else {
      const [{ UniverDrawingPlugin }, { UniverSlidesPlugin, SLIDE_KEY }, { UniverSlidesUIPlugin, ActivateSlidePageOperation, SetSlidePageThumbOperation }, { default: locale }] = await Promise.all([
        import('@univerjs/drawing'), import('@univerjs/slides'), import('@univerjs/slides-ui'), import('@univerjs/slides-ui/locale/zh-CN'),
      ])
      if (signal.aborted) { dispose(); return }
      univer.registerPlugin(UniverDrawingPlugin)
      univer.registerPlugin(UniverSlidesPlugin)
      univer.registerPlugin(UniverSlidesUIPlugin)
      univer.__getInjector().get(LocaleService).load({ [LocaleType.ZH_CN]: locale })
      slideViewport = SLIDE_KEY.VIEW
      slideViewCommands.add(ActivateSlidePageOperation.id); slideViewCommands.add(SetSlidePageThumbOperation.id)
      univer.createUnit(UniverInstanceType.UNIVER_SLIDE, preview.data)
    }
    if (signal.aborted) { dispose(); return }
    // Slides has no permission facade and uses operations for data writes too.
    // Permit only its page navigation and thumbnail rendering operations.
    if (preview.kind === 'slides') subscriptions.push(univer.__getInjector().get(ICommandService).beforeCommandExecuted(command => {
      if (command.type === CommandType.MUTATION || command.id.startsWith('slide.') && !slideViewCommands.has(command.id)) throw new Error('Office 预览为只读。')
    }))
    for (const type of ['pointerdown', 'mousedown', 'dblclick']) container.addEventListener(type, preventSlideEditing, true)
    if (preview.kind === 'sheet') univer.__getInjector().get(LocaleService).load({ [LocaleType.ZH_CN]: { permission: { dialog: {
      alertContent: '当前文件为只读预览，无法修改。', commonErr: '当前文件为只读预览，无法执行此操作。', editErr: '当前文件为只读预览，无法修改。', pasteErr: '当前文件为只读预览，无法粘贴。', setStyleErr: '当前文件为只读预览，无法修改样式。', cutErr: '当前文件为只读预览，无法剪切。', setRowColStyleErr: '当前文件为只读预览，无法修改样式。',
    } } } })
    univer.__getInjector().get(ThemeService).setDarkMode(document.documentElement.dataset.theme === 'dark')
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    resize.observe(container)
    if (preview.kind === 'slides') container.style.setProperty('--office-slide-ratio', `${preview.data.pageSize.width ?? 960} / ${preview.data.pageSize.height ?? 540}`)
    // Unit creation precedes React's workbench mount. Wait for its real canvas
    // before fitting pages and exposing the finished preview.
    await new Promise<void>((resolve, reject) => {
      const started = performance.now()
      finishReady = resolve
      const tick = () => {
        if (disposed) { resolve(); return }
        const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(preview.data.id)
        if (render && render.engine.width > 1 && render.engine.height > 1 && render.engine.getCanvas().getCanvasEle().isConnected) { resolve(); return }
        if (performance.now() - started > 10_000) { reject(new Error('文档预览初始化失败，请重试。')); return }
        readyFrame = requestAnimationFrame(tick)
      }
      tick()
    })
    finishReady = undefined
    if (signal.aborted) { dispose(); return }
    const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(preview.data.id)
    if (render) {
      const subscription = render.engine.onTransformChange$.subscribeEvent(() => {
        cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh)
      })
      subscriptions.push({ dispose: () => subscription.unsubscribe() })
      resize.observe(render.engine.getCanvas().getCanvasEle())
    }
    refresh()
    return { warnings: preview.warnings, dispose: () => { signal.removeEventListener('abort', dispose); dispose() } }
  } catch (error) { signal.removeEventListener('abort', dispose); dispose(); if (!signal.aborted) throw error }
}
