import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

describe('LING renderer client entry', () => {
  it('waits for the DSH facades and replaces uiRenderer', () => {
    const effect = vi.fn()
    const provide = vi.fn()
    const ctx = {
      effect,
      reflect: { provide },
      sessions: {},
      workspaces: {},
      fileUpload: {},
      uiConversation: {},
      uiSession: { sessionStatus: {} },
    } as unknown as Context

    apply(ctx)

    expect(inject).toEqual(['sessions', 'workspaces', 'fileUpload', 'uiConversation', 'uiSession'])
    expect(effect).toHaveBeenCalledWith(expect.any(Function), 'LING renderer stylesheet')
    expect(provide).toHaveBeenCalledWith('uiRenderer', { mount: expect.any(Function) })
  })
})
