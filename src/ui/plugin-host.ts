import type { ReactNode } from 'react'
import {
  lingUiExtensions,
  type LingUiExtensionRegistry,
  type LingUiRegistration,
} from './registry.js'

type WithoutRegistrant<Registration> = Registration extends LingUiRegistration
  ? Omit<Registration, 'registrant'>
  : never

export type LingUiPluginRegistration = WithoutRegistrant<LingUiRegistration>

export interface LingUiPluginSlots {
  register(registration: LingUiPluginRegistration, content: ReactNode): () => void
}

export interface LingUiPluginContext {
  readonly slots: LingUiPluginSlots
}

export interface LingUiPluginDefinition {
  readonly id: string
  readonly setup: (context: LingUiPluginContext) => void | (() => void)
}

export interface LingUiPluginHost {
  readonly has: (id: string) => boolean
  readonly install: (definition: LingUiPluginDefinition) => () => void
  readonly uninstall: (id: string) => boolean
}

interface InstalledPlugin {
  readonly cleanup?: () => void
  readonly disposeRegistrations: () => void
}

class LingUiPluginHostCore implements LingUiPluginHost {
  readonly #plugins = new Map<string, InstalledPlugin>()

  constructor(private readonly registry: LingUiExtensionRegistry) {}

  readonly has = (id: string): boolean => this.#plugins.has(id)

  readonly install = (definition: LingUiPluginDefinition): (() => void) => {
    const id = definition.id.trim()
    if (!id) throw new Error('LING UI plugin requires a non-empty id')
    if (this.#plugins.has(id)) throw new Error(`LING UI plugin "${id}" is already installed`)

    const disposers = new Set<() => void>()
    const slots: LingUiPluginSlots = {
      register: (registration, content) => {
        let live = true
        const disposeRegistration = this.registry.register({
          ...registration,
          registrant: id,
        } as LingUiRegistration, content)
        const dispose = () => {
          if (!live) return
          live = false
          disposers.delete(dispose)
          disposeRegistration()
        }
        disposers.add(dispose)
        return dispose
      },
    }

    let cleanup: void | (() => void)
    try {
      cleanup = definition.setup({ slots })
    } catch (error) {
      for (const dispose of [...disposers].reverse()) dispose()
      this.registry.disposeRegistrant(id)
      throw error
    }

    const installed: InstalledPlugin = {
      cleanup: cleanup ?? undefined,
      disposeRegistrations: () => {
        for (const dispose of [...disposers].reverse()) dispose()
        this.registry.disposeRegistrant(id)
      },
    }
    this.#plugins.set(id, installed)

    let live = true
    return () => {
      if (!live) return
      live = false
      this.uninstall(id)
    }
  }

  readonly uninstall = (id: string): boolean => {
    const installed = this.#plugins.get(id)
    if (!installed) return false
    this.#plugins.delete(id)
    try {
      installed.cleanup?.()
    } finally {
      installed.disposeRegistrations()
    }
    return true
  }
}

export function createLingUiPluginHost(
  registry: LingUiExtensionRegistry = lingUiExtensions,
): LingUiPluginHost {
  return new LingUiPluginHostCore(registry)
}

export const lingUiPluginHost = createLingUiPluginHost()
