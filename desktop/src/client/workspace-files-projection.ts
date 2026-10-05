import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-office-to-pdf/remote'
import type { OfficeToPdfErrorCode } from '@deepseek-ai/dsh-office-to-pdf/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LingWorkspaceDocumentsRemote } from '../workspace-document-contract.ts'
import type {
  LingCommandRejectionReason,
  LingReadResult,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
  LingWorkspaceEntry,
} from 'ling-desktop/runtime'

const ROOT_PATH = '.'
const PREVIEW_LINES = 600

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}
const OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])
const OPEN_OFFICE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])
const CODE_EXTENSIONS = new Set([
  'c', 'cc', 'clj', 'cljs', 'cmake', 'cpp', 'cs', 'css', 'cxx', 'dart', 'dockerfile', 'ex', 'exs',
  'fs', 'fsx', 'go', 'gradle', 'groovy', 'h', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'jsx',
  'json', 'jsonc', 'kt', 'kts', 'less', 'lua', 'm', 'make', 'mdx', 'mm', 'php', 'pl', 'pm', 'proto',
  'py', 'pyi', 'r', 'rb', 'rs', 'sass', 'scala', 'scss', 'sh', 'sol', 'sql', 'svelte', 'swift',
  'tf', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml', 'zig', 'zsh',
])
const UNVIEWABLE_BINARY_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'tar', 'jar',
  'odt', 'ods', 'odp', 'pages', 'numbers',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'class', 'pyc', 'wasm',
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'dmg', 'iso', 'img', 'sqlite', 'db',
  'psd', 'ai', 'sketch', 'tiff', 'tif', 'heic', 'heif',
])
const OFFICE_FAILURE_COPY: Readonly<Record<OfficeToPdfErrorCode, { readonly message: string; readonly retryable: boolean }>> = {
  'input-too-large': { message: '文档过大，无法转换预览。', retryable: false },
  'output-too-large': { message: '转换结果过大，无法预览。', retryable: false },
  'invalid-document': { message: '文档内容无效，无法转换预览。', retryable: false },
  'unsupported-format': { message: '暂不支持这种文档格式的预览。', retryable: false },
  'invalid-output': { message: '文档转换结果无效。', retryable: false },
  timeout: { message: '文档转换超时，请重试。', retryable: true },
  unavailable: { message: '文档转换服务暂时不可用。', retryable: true },
  failed: { message: '文档转换失败，请重试。', retryable: true },
  busy: { message: '文档转换服务正忙，请稍后重试。', retryable: true },
  'source-changed': { message: '文档在读取时发生变化，请重试。', retryable: true },
}

function officeFailure(reason: string): { readonly message: string; readonly retryable: boolean } {
  return OFFICE_FAILURE_COPY[reason as OfficeToPdfErrorCode] ?? OFFICE_FAILURE_COPY.failed
}

function rejected<Value>(
  reason: LingCommandRejectionReason,
  message: string,
  retryable = false,
): LingReadResult<Value> {
  return { ok: false, reason, message, retryable }
}

function remoteFailure<Value>(error: { readonly code: string; readonly message?: string }): LingReadResult<Value> {
  const reason = /permission|denied|forbidden/i.test(error.code)
    ? 'permission-denied'
    : /conflict|stale-version/i.test(error.code)
      ? 'document-conflict'
    : /not-found/i.test(error.code)
      ? 'invalid-command'
      : /outside-workspace|not-directory|not-regular-file|not-text|too-large|readonly|aborted|cancelled|invalid|bad-request|validation/i.test(error.code)
        ? 'invalid-command'
        : 'runtime-unavailable'
  return rejected(reason, error.message?.trim() || '操作未能完成。', /transport|connection|timeout|unavailable/i.test(error.code))
}

function childPath(directory: string, name: string): string {
  return directory.length === 0 ? name : `${directory}/${name}`
}

function documentSuffix(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

export function createDshWorkspaceFilesProjection(remote: ClientRemote, editor?: LingWorkspaceDocumentsRemote) {
  return {
    ...(editor === undefined ? {} : {
      async listDraftDirectory(workspaceId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>> {
        try { const result = await editor.list({ workspaceId, path }, signal); return result.ok ? result : remoteFailure(result.error) }
        catch { return rejected('runtime-unavailable', '目录内容暂时不可用。', true) }
      },
      async readDraftDocument(workspaceId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>> {
        const suffix = documentSuffix(path)
        if (OPEN_OFFICE_MEDIA_TYPES[suffix]) {
          try {
            const result = await editor.readOffice({ workspaceId, path }, signal)
            return result.ok ? { ok: true, value: { path, kind: 'office', mediaType: OPEN_OFFICE_MEDIA_TYPES[suffix]!, data: result.value.data, bytes: result.value.bytes } } : remoteFailure(result.error)
          } catch { return rejected('runtime-unavailable', '文档预览暂时不可用。', true) }
        }
        const mediaType = IMAGE_MEDIA_TYPES[suffix] ?? (suffix === 'pdf' ? 'application/pdf' : undefined)
        if (mediaType) {
          try {
            const result = await editor.readBinary({ workspaceId, path }, signal)
            return result.ok ? { ok: true, value: { path, kind: suffix === 'pdf' ? 'pdf' : 'image', mediaType, data: result.value.data, bytes: result.value.bytes } } : remoteFailure(result.error)
          } catch { return rejected('runtime-unavailable', '文档预览暂时不可用。', true) }
        }
        if (OFFICE_EXTENSIONS.has(suffix) || UNVIEWABLE_BINARY_EXTENSIONS.has(suffix)) {
          return { ok: true, value: { path, kind: 'unsupported', mediaType: 'application/octet-stream' } }
        }
        try {
          const result = await editor.read({ workspaceId, path }, signal)
          if (!result.ok) return remoteFailure(result.error)
          const kind = MARKDOWN_EXTENSIONS.has(suffix) ? 'markdown' : CODE_EXTENSIONS.has(suffix) ? 'code' : 'text'
          return { ok: true, value: { path, kind, mediaType: kind === 'markdown' ? 'text/markdown' : 'text/plain', text: result.value.text,
            bytes: result.value.bytes, version: result.value.version, lines: result.value.text.length === 0 ? 0 : result.value.text.split('\n').length, truncated: false } }
        } catch { return rejected('runtime-unavailable', '文档暂时不可用。', true) }
      },
      async saveDraftDocument(workspaceId: string, path: string, text: string, version: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly version: string }>> {
        try { const result = await editor.save({ workspaceId, path, text, version }, signal); return result.ok ? result : remoteFailure(result.error) }
        catch { return rejected('runtime-unavailable', '文件未能保存，请重试。', true) }
      },
      async saveDocument(taskId: string, path: string, text: string, version: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly version: string }>> {
        try {
          const result = await editor.save({ taskId, path, text, version }, signal)
          return result.ok ? result : remoteFailure(result.error)
        } catch {
          return rejected('runtime-unavailable', '文件未能保存，请重试。', true)
        }
      },
    }),
    async list(taskId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>> {
      try {
        const result = await remote.workspaceFiles.list(
          brandString<SessionId>(taskId),
          path.length === 0 ? ROOT_PATH : path,
          signal,
        )
        if (!result.ok) return remoteFailure(result.error)
        const entries: LingWorkspaceEntry[] = result.value.entries.map(entry => ({
          name: entry.name,
          path: childPath(result.value.path, entry.name),
          kind: entry.type,
          ...(entry.size === undefined ? {} : { bytes: entry.size }),
        }))
        return { ok: true, value: { path: result.value.path, entries, truncated: result.value.truncated } }
      } catch {
        return rejected('runtime-unavailable', '目录内容暂时不可用。', true)
      }
    },
    async readDocument(taskId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>> {
      const suffix = documentSuffix(path)
      try {
        if (OPEN_OFFICE_MEDIA_TYPES[suffix]) {
          const result = editor
            ? await editor.readOffice({ taskId, path }, signal)
            : await remote.workspaceFiles.readAll(brandString<SessionId>(taskId), path, signal)
          if (!result.ok) return remoteFailure(result.error)
          return { ok: true, value: { path, kind: 'office', mediaType: OPEN_OFFICE_MEDIA_TYPES[suffix]!, data: result.value.data, ...(result.value.bytes === undefined ? {} : { bytes: result.value.bytes }) } }
        }
        if (OFFICE_EXTENSIONS.has(suffix)) {
          const result = await remote.officeToPdf.render(brandString<SessionId>(taskId), path, 'foreground', signal)
          if (!result.ok) {
            if (result.error.code === 'document-render/failed') {
              const copy = officeFailure(result.error.details.reason)
              return rejected('invalid-command', copy.message, copy.retryable)
            }
            return remoteFailure(result.error)
          }
          return {
            ok: true,
            value: {
              path,
              kind: 'pdf',
              mediaType: 'application/pdf',
              data: result.value.data,
              converted: true,
              missingFonts: [...result.value.missingFonts],
              ...(result.value.bytes === undefined ? {} : { bytes: result.value.bytes }),
            },
          }
        }
        const imageMediaType = IMAGE_MEDIA_TYPES[suffix] ?? (suffix === 'pdf' ? 'application/pdf' : undefined)
        if (imageMediaType !== undefined) {
          const result = await remote.workspaceFiles.readAll(brandString<SessionId>(taskId), path, signal)
          if (!result.ok) {
            if (/too-large/i.test(result.error.code)) return rejected('invalid-command', '文件过大，无法预览。')
            return remoteFailure(result.error)
          }
          return {
            ok: true,
            value: {
              path,
              kind: suffix === 'pdf' ? 'pdf' : 'image',
              mediaType: imageMediaType,
              data: result.value.data,
              ...(result.value.bytes === undefined ? {} : { bytes: result.value.bytes }),
            },
          }
        }
        if (UNVIEWABLE_BINARY_EXTENSIONS.has(suffix)) {
          return { ok: true, value: { path, kind: 'unsupported', mediaType: 'application/octet-stream' } }
        }
        const kind = MARKDOWN_EXTENSIONS.has(suffix) ? 'markdown' : CODE_EXTENSIONS.has(suffix) ? 'code' : 'text'
        if (editor !== undefined) {
          const full = await editor.read({ taskId, path }, signal)
          if (full.ok) {
            return { ok: true, value: { path, kind, mediaType: kind === 'markdown' ? 'text/markdown' : 'text/plain',
              text: full.value.text, bytes: full.value.bytes, version: full.value.version,
              lines: full.value.text.length === 0 ? 0 : full.value.text.split('\n').length, truncated: false } }
          }
          // A preview never carries a save version. Unsupported paths and large
          // files retain the upstream read-only preview; text errors remain errors.
          if (!/readonly|too-large|unavailable/i.test(full.error.code)) return remoteFailure(full.error)
        }
        const result = await remote.workspaceFiles.read(brandString<SessionId>(taskId), path, { limit: PREVIEW_LINES }, signal)
        if (!result.ok) return remoteFailure(result.error)
        return {
          ok: true,
          value: {
            path,
            kind,
            mediaType: kind === 'markdown' ? 'text/markdown' : 'text/plain',
            text: result.value.text,
            lines: result.value.lines,
            truncated: !result.value.eof,
            ...(result.value.bytes === undefined ? {} : { bytes: result.value.bytes }),
          },
        }
      } catch {
        return rejected('runtime-unavailable', '文档预览暂时不可用。', true)
      }
    },
  }
}
