/** One portable filename/MIME mapping shared by the file tree, attachments and deliveries. */
export type FileIconType = 'file' | 'folder' | 'code' | 'markdown' | 'document' | 'pdf' | 'spreadsheet' | 'presentation' | 'image' | 'audio' | 'video' | 'archive'

const extensions: Readonly<Record<Exclude<FileIconType, 'file' | 'folder'>, readonly string[]>> = {
  code: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'sql', 'r', 'lua', 'dart', 'ipynb'],
  markdown: ['md', 'markdown', 'mdown', 'mdx'],
  document: ['txt', 'rtf', 'doc', 'docx', 'odt', 'pages', 'tex', 'log'],
  pdf: ['pdf'],
  spreadsheet: ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'ico'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'opus', 'aiff'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpeg', 'mpg'],
  archive: ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz', 'zst'],
}
const typesByExtension = new Map(Object.entries(extensions).flatMap(([type, values]) => values.map(extension => [extension, type as FileIconType] as const)))

export function fileIconType(path: string, mediaType?: string): FileIconType {
  let name = path
  if (/^https?:\/\//iu.test(path)) {
    try { name = decodeURIComponent(new URL(path).pathname) } catch { /* Keep the original filename if malformed. */ }
  }
  const basename = name.split(/[\\/]/u).at(-1)?.toLocaleLowerCase() ?? ''
  const extension = basename.includes('.') ? basename.split('.').at(-1)! : ''
  const fromExtension = typesByExtension.get(extension)
  if (fromExtension) return fromExtension
  const media = mediaType?.toLocaleLowerCase().split(';')[0]?.trim()
  if (media?.startsWith('image/')) return 'image'
  if (media?.startsWith('audio/')) return 'audio'
  if (media?.startsWith('video/')) return 'video'
  if (media === 'application/pdf') return 'pdf'
  if (media === 'text/markdown') return 'markdown'
  if (media === 'text/csv' || media === 'text/tab-separated-values' || /spreadsheet|excel/u.test(media ?? '')) return 'spreadsheet'
  if (/presentation|powerpoint/u.test(media ?? '')) return 'presentation'
  if (/word|opendocument.text|text\/plain/u.test(media ?? '')) return 'document'
  if (/zip|compressed|archive|x-tar/u.test(media ?? '')) return 'archive'
  if (/json|javascript|typescript|xml/u.test(media ?? '')) return 'code'
  return 'file'
}
