import { z } from 'zod'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { LingModelCatalogState } from 'ling-desktop/runtime'
import type { LingDiscoveredModel } from 'ling-desktop/runtime'

export const catalogStateSchema = z.object({
  providerId: z.string(), supported: z.boolean(), source: z.enum(['builtin', 'endpoint']), updatedAt: z.number().optional(),
  refreshing: z.boolean(), pending: z.boolean(), error: z.string().optional(),
  newModelIds: z.array(z.string()), missingModelIds: z.array(z.string()), unverifiedModelIds: z.array(z.string()),
  efforts: z.record(z.string(), z.array(z.string())).optional(),
}).strict()
export interface LingModelCatalogRemote {
  list(signal?: AbortSignal): Promise<RemoteResult<readonly LingModelCatalogState[]>>
  refresh(providerId: string, signal?: AbortSignal): Promise<RemoteResult<LingModelCatalogState>>
  probe(providerId: string, signal?: AbortSignal): Promise<RemoteResult<readonly LingDiscoveredModel[]>>
}
const descriptors: readonly InvocationDescriptor[] = [
  { id: 'ling-desktop-host/model-catalog#lingModelCatalog/list', service: 'lingModelCatalog', namespace: 'lingModelCatalog', method: 'list', invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' }, result: { mode: 'strict', typeSymbol: 'ling-desktop-host/model-catalog#CatalogStates', create: () => z.array(catalogStateSchema) } },
  { id: 'ling-desktop-host/model-catalog#lingModelCatalog/refresh', service: 'lingModelCatalog', namespace: 'lingModelCatalog', method: 'refresh', invocation: { kind: 'direct' }, parameters: [{ name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'strict', typeSymbol: 'ling-desktop-host/model-catalog#ProviderId', create: () => z.string().min(1).max(128) } }], cancellation: { parameter: 'signal' }, result: { mode: 'strict', typeSymbol: 'ling-desktop-host/model-catalog#CatalogState', create: () => catalogStateSchema } },
  { id: 'ling-desktop-host/model-catalog#lingModelCatalog/probe', service: 'lingModelCatalog', namespace: 'lingModelCatalog', method: 'probe', invocation: { kind: 'direct' }, parameters: [{ name: 'providerId', wire: 'providerId', source: 'json', codec: { mode: 'strict', typeSymbol: 'ling-desktop-host/model-catalog#ProviderId', create: () => z.string().min(1).max(128) } }], cancellation: { parameter: 'signal' }, result: { mode: 'strict', typeSymbol: 'ling-desktop-host/model-catalog#DiscoveredModels', create: () => z.array(z.object({ id: z.string(), name: z.string().optional(), contextWindow: z.number().optional() }).strict()) } },
]
export const LING_MODEL_CATALOG_REMOTE: TypertRemoteContribution = { package: 'ling-desktop-host/model-catalog', descriptors }
export const LING_MODEL_CATALOG_HOST: TypertContribution = { package: 'ling-desktop-host/model-catalog', face: 'host', schemas: [], invocations: descriptors, model: { services: [{ key: 'lingModelCatalog', exportName: 'LingModelCatalogController', summary: 'Refresh provider model data through the configured endpoint, retaining user choices and offline catalogs.', tags: [], members: [], types: [] }], events: [], objects: [] } }
