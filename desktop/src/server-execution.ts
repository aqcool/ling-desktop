import type { LingServerExecution } from 'ling-desktop/runtime'
export interface ServerOutput { readonly stream: 'stdout' | 'stderr'; readonly data: string }
export type ServerExecutionStart = Omit<LingServerExecution, 'output' | 'status' | 'exitCode' | 'error'>
