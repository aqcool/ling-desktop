import { extendTailwindMerge } from 'tailwind-merge'

// Teach the merger the theme's custom sizes so text colors cannot erase font sizes.
const twMerge = extendTailwindMerge({ extend: { theme: {
  text: ['micro', 'caption', 'compact', 'md'],
  spacing: ['control-xs', 'control-sm', 'control', 'control-lg'],
} } })

export type ClassNameValue = string | false | null | undefined

/** Merge colocated Tailwind utilities without owning component styles. */
export function tw(...values: readonly ClassNameValue[]): string {
  return twMerge(values.filter((value): value is string => typeof value === 'string' && value.length > 0).join(' '))
}
