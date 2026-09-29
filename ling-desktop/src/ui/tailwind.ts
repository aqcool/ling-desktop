import { twMerge } from 'tailwind-merge'

export type ClassNameValue = string | false | null | undefined

/** Merge colocated Tailwind utilities without owning component styles. */
export function tw(...values: readonly ClassNameValue[]): string {
  return twMerge(values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' '))
}
