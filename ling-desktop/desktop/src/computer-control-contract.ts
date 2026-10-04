import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { LingComputerCapabilities, LingComputerSnapshot } from 'ling-desktop/runtime'

export interface LingComputerControlRemote {
  capabilities(): Promise<RemoteResult<LingComputerCapabilities>>
  snapshot(): Promise<RemoteResult<LingComputerSnapshot>>
}
export const snapshotSchema = z.object({
  title: z.string().max(512), text: z.string().max(65536),
  images: z.array(z.object({ name: z.string().max(512), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().max(12 * 1024 * 1024) }).strict()).max(2),
}).strict()
const capabilitiesSchema = z.object({ browser: z.boolean(), recording: z.boolean(), snapshot: z.boolean() }).strict()
const descriptors: readonly InvocationDescriptor[] = ['capabilities', 'snapshot'].map(method => ({
  id: `ling-desktop-host/computer-control#lingComputerControl/${method}`, service: 'lingComputerControl', namespace: 'lingComputerControl', method,
  invocation: { kind: 'direct' }, parameters: [],
  result: { mode: 'strict', typeSymbol: `ling-desktop-host/computer-control#${method}`, create: () => method === 'snapshot' ? snapshotSchema : capabilitiesSchema },
}))
export const LING_COMPUTER_CONTROL_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/computer-control', descriptors }
export const LING_COMPUTER_CONTROL_HOST: TypertContribution = { package: 'ling-desktop-host/computer-control', face: 'host', schemas: [], invocations: descriptors,
  model: { services: [{ key: 'lingComputerControl', exportName: 'LingComputerControlController', summary: 'Inspect desktop capabilities and prepare a user-requested foreground snapshot.', tags: [], members: [], types: [] }], events: [], objects: [] } }
