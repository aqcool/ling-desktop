import { describe, expect, it } from 'vitest'
import { composerSkillPresentation, withComposerSkills } from '../src/ui/composer-skills.js'
import { toComposerQuote } from '../src/ui/attachments.js'

describe('skill draft presentation', () => {
  it('round-trips multiple references and multiline prose without rewriting the payload', () => {
    const raw = '/review  /frontend-design \t检查当前改动\n保留 /review 作为示例。'
    const draft = composerSkillPresentation(raw, ['review', 'frontend-design'])
    expect(draft.skills.map(skill => skill.name)).toEqual(['review', 'frontend-design'])
    expect(draft.text).toBe('检查当前改动\n保留 /review 作为示例。')
    expect(withComposerSkills(draft.text, draft.skills)).toBe(raw)
    expect(withComposerSkills(draft.text, draft.skills.slice(1))).toBe('/frontend-design \t检查当前改动\n保留 /review 作为示例。')
  })

  it.each(['/review', '/review-more 检查', '/review/file.md 检查', '/tmp/project', '请执行 /review ', '/unknown /review 检查'])('keeps incomplete invocations, unknown names and ordinary paths editable: %s', text => {
    expect(composerSkillPresentation(text, ['review'])).toEqual({ text, skills: [] })
  })

  it('keeps a skill-only prompt sendable after removing it from the textarea', () => {
    const draft = composerSkillPresentation('/review ', ['review'])
    expect(draft.text).toBe('')
    expect(withComposerSkills(draft.text, draft.skills).trim()).toBe('/review')
    expect(withComposerSkills(draft.text, [])).toBe('')
  })
})

describe('quoted conversation attachments', () => {
  it('previews the complete original reply and sends the same UTF-8 Markdown bytes', () => {
    const text = '### 回复\n\n保留 **格式** 与换行。\n```ts\nconst n = 1\n```'
    const quote = toComposerQuote(text)
    expect(quote.quote).toBe(text)
    expect(quote.attachment.kind).toBe('file')
    expect(quote.attachment.name).toBe('Agent 回复.md')
    expect(quote.attachment.data).toEqual(new TextEncoder().encode(text))
    expect(quote.size).toBe(new TextEncoder().encode(text).byteLength)
    expect(toComposerQuote(text).id).not.toBe(quote.id)
  })

  it('can show rendered text without losing Markdown in the attachment', () => {
    const quote = toComposerQuote('**重点**\n\n[文档](https://example.com)', '重点\n\n文档')
    expect(quote.quote).toBe('重点\n\n文档')
    expect(quote.attachment.data).toEqual(new TextEncoder().encode('**重点**\n\n[文档](https://example.com)'))
  })
})
