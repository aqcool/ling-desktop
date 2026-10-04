import { Icon, type IconName } from './Icon.js'
import { fileIconType, type FileIconType } from './file-icons.js'
import { tw } from './tailwind.js'

const colorIcons: Readonly<Record<FileIconType, IconName>> = {
  file: 'file', folder: 'folder', code: 'code', markdown: 'markdown', document: 'file', pdf: 'book',
  spreadsheet: 'grid', presentation: 'desktop', image: 'image', audio: 'waveform', video: 'playCircle', archive: 'archive',
}

/** CSS switches both variants instantly, including memoized conversation items. */
export function FileIcon({ path, mediaType, directory = false, expanded = false, simpleIcon = 'file', size = 18, className }: {
  readonly path: string
  readonly mediaType?: string
  readonly directory?: boolean
  readonly expanded?: boolean
  readonly simpleIcon?: IconName
  readonly size?: number
  readonly className?: string
}) {
  const type = directory ? 'folder' : fileIconType(path, mediaType)
  const folderIcon = expanded ? 'folderOpen' : 'folder'
  return <span aria-hidden="true" data-file-type={type} className={tw('file-icon inline-grid shrink-0 align-middle', className)} style={{ width: size, height: size }}>
    <span className={tw('file-icon__simple color-files:hidden')}><Icon name={directory ? folderIcon : simpleIcon} size={size} /></span>
    <span data-file-icon={directory ? folderIcon : colorIcons[type]} className={tw('file-icon__color hidden color-files:block forced-colors:[color:CanvasText]!')} style={{ color: `var(--file-icon-${type})` }}><Icon name={directory ? folderIcon : colorIcons[type]} themeArtwork={false} size={size} /></span>
  </span>
}
