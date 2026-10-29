import type { CopyProgress } from './server-copy.ts'

const labels: Record<CopyProgress['phase'], string> = {
  scan: '检查文件', preflight: '校验已有文件', transfer: '上传中', verify: '正在校验传输内容', complete: '拷贝完成',
}

function bytes(current: number, total: number): string {
  const percent = total === 0 ? 100 : Math.min(100, Math.floor(current / total * 100))
  return `${current}/${total} 字节（${percent}%）`
}

/** Keep status boundaries visible even when byte updates arrive within one second. */
export function createCopyProgressReporter(write: (line: string) => void, now: () => number = Date.now) {
  let last: CopyProgress | undefined
  let lastAt = Number.NEGATIVE_INFINITY
  return (progress: CopyProgress) => {
    const time = now()
    const transferred = progress.bytes >= progress.totalBytes
      && (last === undefined || last.bytes < last.totalBytes || last.totalBytes !== progress.totalBytes)
    const verified = progress.totalVerifyBytes !== undefined && progress.verifiedBytes === progress.totalVerifyBytes
      && (last === undefined || last.verifiedBytes !== last.totalVerifyBytes || last.totalVerifyBytes !== progress.totalVerifyBytes)
    if (progress.phase === last?.phase && progress.phase !== 'complete' && !transferred && !verified && time - lastAt < 1000) return
    last = progress; lastAt = time
    const transfer = progress.phase === 'preflight' ? '' : ` · 已传输 ${bytes(progress.bytes, progress.totalBytes)}`
    const verification = progress.totalVerifyBytes === undefined ? ''
      : ` · 已校验 ${bytes(progress.verifiedBytes ?? 0, progress.totalVerifyBytes)}（本地与远端合计）`
    write(`${labels[progress.phase]} · 已完成 ${progress.copied}/${progress.files} 个文件 · 跳过 ${progress.skipped} 个${transfer}${verification}${progress.path ? ` · ${progress.path}` : ''}\n`)
  }
}
