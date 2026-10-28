import { describe, expect, it, vi } from 'vitest'
import { UpdateInstallation, type UpdateInstallationHooks } from '../src/update-installation.ts'

function fixture() {
  const hooks = {
    tasks: vi.fn<UpdateInstallationHooks['tasks']>().mockResolvedValue(false),
    hasTransfers: vi.fn().mockReturnValue(false),
    confirm: vi.fn().mockResolvedValue(true),
    busy: vi.fn().mockResolvedValue(undefined),
    saveState: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    recover: vi.fn().mockResolvedValue(undefined),
  }
  return { hooks, installation: new UpdateInstallation(hooks) }
}

describe('update installation handoff', () => {
  it('leaves running work untouched before asking to restart', async () => {
    const { hooks, installation } = fixture()
    hooks.tasks.mockResolvedValue(true)
    expect(await installation.prepare()).toBe(false)
    expect(hooks.confirm).not.toHaveBeenCalled()
    expect(hooks.stop).not.toHaveBeenCalled()
    expect(hooks.busy).toHaveBeenCalledOnce()
  })
  it('does nothing when the restart confirmation is cancelled', async () => {
    const { hooks, installation } = fixture()
    hooks.confirm.mockResolvedValue(false)
    expect(await installation.prepare()).toBe(false)
    expect(hooks.tasks.mock.calls).toEqual([['inspect']])
    expect(hooks.stop).not.toHaveBeenCalled()
  })
  it('rechecks work admitted while the confirmation was open and unlocks', async () => {
    const { hooks, installation } = fixture()
    hooks.tasks.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await installation.prepare()).toBe(false)
    expect(hooks.tasks.mock.calls).toEqual([['inspect'], ['lock'], ['unlock']])
    expect(hooks.stop).not.toHaveBeenCalled()
  })
  it('retains detached SFTP jobs after the HTTP request finishes', async () => {
    const { hooks, installation } = fixture()
    hooks.hasTransfers.mockReturnValueOnce(false).mockReturnValueOnce(true)
    expect(await installation.prepare()).toBe(false)
    expect(hooks.tasks).toHaveBeenLastCalledWith('unlock')
    expect(hooks.stop).not.toHaveBeenCalled()
  })
  it('unlocks even when lock acknowledgement times out', async () => {
    const { hooks, installation } = fixture()
    hooks.tasks.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('timeout'))
    await expect(installation.prepare()).rejects.toThrow('timeout')
    expect(hooks.tasks).toHaveBeenLastCalledWith('unlock')
    expect(hooks.stop).not.toHaveBeenCalled()
  })
  it('saves state before graceful shutdown and retains the lock for installation', async () => {
    const { hooks, installation } = fixture()
    expect(await installation.prepare()).toBe(true)
    expect(hooks.saveState.mock.invocationCallOrder[0]).toBeLessThan(hooks.stop.mock.invocationCallOrder[0]!)
    expect(hooks.tasks.mock.calls).toEqual([['inspect'], ['lock']])
    await installation.recover()
    await installation.recover()
    expect(hooks.recover).toHaveBeenCalledOnce()
  })
  it('does not stop the Host when saving fails', async () => {
    const { hooks, installation } = fixture()
    hooks.saveState.mockRejectedValue(new Error('storage'))
    await expect(installation.prepare()).rejects.toThrow('storage')
    await installation.recover()
    expect(hooks.stop).not.toHaveBeenCalled()
    expect(hooks.recover).not.toHaveBeenCalled()
    expect(hooks.tasks).toHaveBeenLastCalledWith('unlock')
  })
  it('restores the old runtime when graceful shutdown fails', async () => {
    const { hooks, installation } = fixture()
    hooks.stop.mockRejectedValue(new Error('unclean shutdown'))
    await expect(installation.prepare()).rejects.toThrow('unclean shutdown')
    await installation.recover()
    expect(hooks.recover).toHaveBeenCalledOnce()
  })
  it('blocks unsaved content created while the confirmation is open', async () => {
    const { hooks } = fixture()
    const validateState = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const installation = new UpdateInstallation({ ...hooks, validateState })
    expect(await installation.prepare()).toBe(false)
    expect(validateState).toHaveBeenCalledTimes(2)
    expect(validateState.mock.calls).toEqual([[false], [true]])
    expect(hooks.tasks).toHaveBeenLastCalledWith('unlock')
    expect(hooks.stop).not.toHaveBeenCalled()
  })
  it('unfreezes windows after a failed final save even if Host unlock also fails', async () => {
    const { hooks } = fixture()
    const releaseState = vi.fn()
    hooks.tasks.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('unavailable'))
    hooks.saveState.mockRejectedValue(new Error('storage'))
    await expect(new UpdateInstallation({ ...hooks, releaseState }).prepare()).rejects.toThrow()
    expect(releaseState).toHaveBeenCalledOnce()
  })
})
