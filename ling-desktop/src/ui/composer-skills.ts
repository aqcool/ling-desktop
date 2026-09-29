interface SkillReference {
  readonly name: string
  readonly prefix: string
}

/** Only a completed, known leading invocation becomes a chip; prose and paths stay editable. */
export function composerSkillPresentation(text: string, skillNames: readonly string[]): { text: string; skills: SkillReference[] } {
  const names = new Set(skillNames)
  const skills: SkillReference[] = []
  let rest = text
  for (;;) {
    const match = /^\/([^\s]+)([ \t]+)/u.exec(rest)
    if (!match || !names.has(match[1]!)) break
    skills.push({ name: match[1]!, prefix: match[0] })
    rest = rest.slice(match[0].length)
  }
  return { text: rest, skills }
}

export function withComposerSkills(text: string, skills: readonly SkillReference[]): string {
  return skills.map(skill => skill.prefix).join('') + text
}
