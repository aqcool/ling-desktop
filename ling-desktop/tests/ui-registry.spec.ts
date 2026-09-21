import { describe, expect, it, vi } from 'vitest'
import {
  createLingUiExtensionRegistry,
  mergeLingUiSlots,
} from '../src/ui/registry.js'
import { createLingUiPluginHost } from '../src/ui/plugin-host.js'

describe('LING UI extension registry', () => {
  it('uses priority shadowing for single slots and restores the next entry on dispose', () => {
    const registry = createLingUiExtensionRegistry()
    const disposeFallback = registry.register({
      name: 'rightbar.session',
      priority: 10,
      registrant: 'fallback-plugin',
    }, 'fallback')
    const disposePreferred = registry.register({
      name: 'rightbar.session',
      priority: -10,
      registrant: 'preferred-plugin',
    }, 'preferred')

    expect(registry.getSnapshot()['rightbar.session']).toBe('preferred')
    expect(() => registry.register({
      name: 'rightbar.session',
      priority: -10,
    }, 'conflict')).toThrow('already has')

    disposePreferred()
    expect(registry.getSnapshot()['rightbar.session']).toBe('fallback')
    disposeFallback()
    expect(registry.getSnapshot()['rightbar.session']).toBeUndefined()
  })

  it('orders list entries and shadows matching ids independently', () => {
    const registry = createLingUiExtensionRegistry()
    registry.register({ id: 'third', name: 'sidebar.panellist', order: 30 }, 'third')
    registry.register({ id: 'first', name: 'sidebar.panellist', order: 10, priority: 5 }, 'first-fallback')
    const disposePreferred = registry.register({
      id: 'first',
      name: 'sidebar.panellist',
      order: 10,
      priority: -5,
    }, 'first')
    registry.register({ id: 'second', name: 'sidebar.panellist', order: 20 }, 'second')

    expect(registry.getSnapshot()['sidebar.panellist']).toEqual(['first', 'second', 'third'])
    disposePreferred()
    expect(registry.getSnapshot()['sidebar.panellist']).toEqual(['first-fallback', 'second', 'third'])
  })

  it('publishes stable snapshots and disposes all entries from one registrant', () => {
    const registry = createLingUiExtensionRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    const initial = registry.getSnapshot()

    const dispose = registry.register({
      id: 'action',
      name: 'sidebar.footer.action',
      registrant: 'community.example',
    }, 'action')
    registry.register({
      name: 'sidebar.brand.mark',
      registrant: 'community.example',
    }, 'mark')

    expect(registry.getSnapshot()).not.toBe(initial)
    expect(registry.disposeRegistrant('community.example')).toBe(2)
    expect(registry.getSnapshot()).toEqual({})
    dispose()
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('keeps static owner content while registered single slots take precedence', () => {
    expect(mergeLingUiSlots({
      'conversation.input.left': ['owner'],
      'rightbar.session': 'owner',
    }, {
      'conversation.input.left': ['plugin'],
      'rightbar.session': 'plugin',
    })).toEqual({
      'conversation.input.left': ['owner', 'plugin'],
      'rightbar.session': 'plugin',
    })
  })

  it('binds plugin registrations to one disposable plugin lifetime', () => {
    const registry = createLingUiExtensionRegistry()
    const host = createLingUiPluginHost(registry)
    const cleanup = vi.fn()
    const dispose = host.install({
      id: 'community.example',
      setup: ({ slots }) => {
        slots.register({ id: 'example-action', name: 'sidebar.footer.action' }, 'action')
        slots.register({ name: 'conversation.hero.brand.mark' }, 'brand')
        return cleanup
      },
    })

    expect(host.has('community.example')).toBe(true)
    expect(registry.getSnapshot()).toEqual({
      'conversation.hero.brand.mark': 'brand',
      'sidebar.footer.action': ['action'],
    })
    expect(() => host.install({ id: 'community.example', setup: () => {} })).toThrow('already installed')

    dispose()
    dispose()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(host.has('community.example')).toBe(false)
    expect(registry.getSnapshot()).toEqual({})
  })

  it('rolls back slot registrations when plugin setup fails', () => {
    const registry = createLingUiExtensionRegistry()
    const host = createLingUiPluginHost(registry)

    expect(() => host.install({
      id: 'community.broken',
      setup: ({ slots }) => {
        slots.register({ name: 'rightbar.session' }, 'temporary')
        throw new Error('setup failed')
      },
    })).toThrow('setup failed')

    expect(host.has('community.broken')).toBe(false)
    expect(registry.getSnapshot()).toEqual({})
  })
})
