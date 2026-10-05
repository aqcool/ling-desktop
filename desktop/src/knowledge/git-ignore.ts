import ignore, { type Ignore } from 'ignore'

/** Rules stay relative to each .gitignore; deeper negations override file rules. */
export class GitIgnoreRules {
  private readonly rules: { directory: string; matcher: Ignore }[] = []
  add(directory: string, text: string): void {
    this.rules.push({ directory, matcher: ignore().add(text) })
  }
  ignores(path: string, directory = false): boolean {
    let ignored = false
    for (const rule of this.rules) {
      if (rule.directory && !path.startsWith(`${rule.directory}/`)) continue
      const relative = rule.directory ? path.slice(rule.directory.length + 1) : path
      const result = rule.matcher.test(`${relative}${directory ? '/' : ''}`)
      if (result.ignored) ignored = true
      else if (result.unignored) ignored = false
    }
    return ignored
  }
}
