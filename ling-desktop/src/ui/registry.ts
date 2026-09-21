import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import {
  lingUiSlotKinds,
  type LingUiListSlotName,
  type LingUiSingleSlotName,
  type LingUiSlotName,
  type LingUiSlots,
} from './slots.js'

interface LingUiRegistrationBase<Name extends LingUiSlotName> {
  readonly name: Name
  readonly priority?: number
  readonly registrant?: string
}

export type LingUiSingleRegistration = {
  [Name in LingUiSingleSlotName]: LingUiRegistrationBase<Name>
}[LingUiSingleSlotName]

export type LingUiListRegistration = {
  [Name in LingUiListSlotName]: LingUiRegistrationBase<Name> & {
    readonly id: string
    readonly order?: number
  }
}[LingUiListSlotName]

export type LingUiRegistration = LingUiListRegistration | LingUiSingleRegistration

export interface LingUiExtensionRegistry {
  readonly getSnapshot: () => LingUiSlots
  readonly register: (registration: LingUiRegistration, content: ReactNode) => () => void
  readonly disposeRegistrant: (registrant: string) => number
  readonly subscribe: (listener: () => void) => () => void
}

interface StoredRegistration {
  readonly content: ReactNode
  readonly id?: string
  readonly name: LingUiSlotName
  readonly order: number
  readonly priority: number
  readonly registrant?: string
  readonly sequence: number
}

const EMPTY_SLOTS: LingUiSlots = Object.freeze({})

class LingUiExtensionRegistryCore implements LingUiExtensionRegistry {
  readonly #entries = new Map<LingUiSlotName, StoredRegistration[]>()
  readonly #listeners = new Set<() => void>()
  #sequence = 0
  #snapshot = EMPTY_SLOTS

  readonly getSnapshot = (): LingUiSlots => this.#snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  readonly register = (registration: LingUiRegistration, content: ReactNode): (() => void) => {
    const kind = lingUiSlotKinds[registration.name]
    const priority = registration.priority ?? 0
    const id = kind === 'list' ? (registration as LingUiListRegistration).id : undefined

    if (content === undefined) {
      throw new Error(`slot "${registration.name}" requires content`)
    }
    if (kind === 'list' && !id) {
      throw new Error(`list slot "${registration.name}" requires an id`)
    }

    const current = this.#entries.get(registration.name) ?? []
    const occupied = current.find(entry => entry.id === id && entry.priority === priority)
    if (occupied) {
      const cell = id ? `entry "${id}"` : 'registration'
      throw new Error(`${kind} slot "${registration.name}" already has ${cell} at priority ${String(priority)}`)
    }

    const entry: StoredRegistration = {
      content,
      id,
      name: registration.name,
      order: kind === 'list' ? ((registration as LingUiListRegistration).order ?? 0) : 0,
      priority,
      registrant: registration.registrant,
      sequence: this.#sequence++,
    }
    const next = [...current, entry].sort((left, right) => (
      left.priority - right.priority
      || (kind === 'list' ? left.order - right.order : 0)
      || left.sequence - right.sequence
    ))
    this.#entries.set(registration.name, next)
    this.#publish()

    return () => {
      const live = this.#entries.get(registration.name)
      if (!live?.includes(entry)) return
      const remaining = live.filter(candidate => candidate !== entry)
      if (remaining.length === 0) this.#entries.delete(registration.name)
      else this.#entries.set(registration.name, remaining)
      this.#publish()
    }
  }

  readonly disposeRegistrant = (registrant: string): number => {
    let disposed = 0
    for (const [name, entries] of this.#entries) {
      const remaining = entries.filter(entry => {
        if (entry.registrant !== registrant) return true
        disposed += 1
        return false
      })
      if (remaining.length === 0) this.#entries.delete(name)
      else if (remaining.length !== entries.length) this.#entries.set(name, remaining)
    }
    if (disposed > 0) this.#publish()
    return disposed
  }

  #publish() {
    const snapshot: Partial<Record<LingUiSlotName, ReactNode | readonly ReactNode[]>> = {}
    for (const [name, entries] of this.#entries) {
      const kind = lingUiSlotKinds[name]
      if (kind === 'single') {
        const winner = entries[0]
        if (winner) snapshot[name] = winner.content
        continue
      }

      const winners: StoredRegistration[] = []
      const ids = new Set<string>()
      for (const entry of entries) {
        if (!entry.id || ids.has(entry.id)) continue
        ids.add(entry.id)
        winners.push(entry)
      }
      winners.sort((left, right) => left.order - right.order || left.sequence - right.sequence)
      snapshot[name] = winners.map(entry => entry.content)
    }
    this.#snapshot = Object.freeze(snapshot) as LingUiSlots
    for (const listener of [...this.#listeners]) listener()
  }
}

export function createLingUiExtensionRegistry(): LingUiExtensionRegistry {
  return new LingUiExtensionRegistryCore()
}

export const lingUiExtensions = createLingUiExtensionRegistry()

export function mergeLingUiSlots(base: LingUiSlots | undefined, registered: LingUiSlots): LingUiSlots {
  if (!base) return registered

  const merged: Partial<Record<LingUiSlotName, ReactNode | readonly ReactNode[]>> = {}
  for (const name of Object.keys(lingUiSlotKinds) as LingUiSlotName[]) {
    const baseValue = base[name]
    const registeredValue = registered[name]
    if (lingUiSlotKinds[name] === 'list') {
      const baseItems = Array.isArray(baseValue) ? baseValue : []
      const registeredItems = Array.isArray(registeredValue) ? registeredValue : []
      if (baseItems.length > 0 || registeredItems.length > 0) {
        merged[name] = [...baseItems, ...registeredItems]
      }
    } else if (registeredValue !== undefined) {
      merged[name] = registeredValue
    } else if (baseValue !== undefined) {
      merged[name] = baseValue
    }
  }
  return merged as LingUiSlots
}

export function useLingUiSlots(
  registry: LingUiExtensionRegistry,
  base?: LingUiSlots,
): LingUiSlots {
  const registered = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  )
  return useMemo(() => mergeLingUiSlots(base, registered), [base, registered])
}
