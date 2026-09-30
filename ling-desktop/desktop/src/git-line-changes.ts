import type { LingGitFile } from 'ling-desktop/runtime'

type RunGit = (args: readonly string[], allowedCodes?: readonly number[]) => Promise<string>

function sumNumstat(raw: string): { added: number; deleted: number } {
  const records = raw.split('\0')
  let added = 0, deleted = 0
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    if (!record) continue
    const first = record.indexOf('\t'), second = record.indexOf('\t', first + 1)
    if (first < 0 || second < 0) throw new Error('无法读取 Git 行数统计。')
    const plus = record.slice(0, first), minus = record.slice(first + 1, second)
    if (plus !== '-' && minus !== '-') {
      if (!/^\d+$/.test(plus) || !/^\d+$/.test(minus)) throw new Error('无法读取 Git 行数统计。')
      added += Number(plus); deleted += Number(minus)
    }
    // With -z a rename carries the old and new paths in separate records.
    if (record.slice(second + 1) === '') index += 2
  }
  return { added, deleted }
}

/** Compare the current files to HEAD; include untracked files without touching the index. */
export async function readGitLineChanges(run: RunGit, files: readonly LingGitFile[], unborn: boolean) {
  const options = ['--numstat', '-z', '--no-ext-diff', '--no-textconv']
  const total = unborn ? { added: 0, deleted: 0 } : sumNumstat(await run(['diff', ...options, 'HEAD', '--']))
  const additions = files.filter(file => unborn ? file.worktree !== 'D' && file.index !== 'D' : file.index === '?')
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, additions.length) }, async () => {
    while (next < additions.length) {
      const file = additions[next++]!
      const counts = sumNumstat(await run(['diff', '--no-index', ...options, '--', '/dev/null', file.path], [0, 1]))
      total.added += counts.added; total.deleted += counts.deleted
    }
  }))
  return total
}
