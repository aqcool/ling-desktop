import { describe, expect, it } from 'vitest'
import { isTaskWindowUrl } from '../src/task-window-url.ts'

describe('task window URLs', () => {
  it('accepts only task deep links on the owned app origin', () => {
    expect(isTaskWindowUrl('dsh-app://app/?task=session-123')).toBe(true)
    expect(isTaskWindowUrl('dsh-app://app/?task=')).toBe(false)
    expect(isTaskWindowUrl('dsh-app://app/')).toBe(false)
    expect(isTaskWindowUrl('dsh-app://app/?task=session-123&other=1')).toBe(false)
    expect(isTaskWindowUrl('dsh-app://app.evil/?task=session-123')).toBe(false)
    expect(isTaskWindowUrl('https://example.com/?task=session-123')).toBe(false)
    expect(isTaskWindowUrl('dsh-app://app/assets/index.js?task=session-123')).toBe(false)
  })
})
