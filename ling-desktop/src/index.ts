/**
 * Entry point for LING-owned desktop presentation.
 *
 * This workspace intentionally starts without a dependency on the upstream
 * DSH UI. Runtime access will arrive through an explicit LING adapter rather
 * than through upstream client components or slots.
 */
export const LING_DESKTOP_RENDERER_OWNER = 'LING' as const
