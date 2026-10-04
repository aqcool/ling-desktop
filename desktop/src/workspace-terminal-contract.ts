import { TYPERT_REMOTE } from '@deepseek-ai/dsh-api-terminal-controller/remote'
import type { TerminalRemote } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'

/** Reuse the terminal wire vocabulary, with a workspace identity instead of an Agent lookup. */
export type LingWorkspaceTerminalRemote = TerminalRemote

export const WORKSPACE_TERMINAL_DESCRIPTORS: readonly InvocationDescriptor[] = TYPERT_REMOTE.descriptors.map(original => {
  const { scope: _scope, sourceLocation: _location, ...descriptor } = original
  return {
    ...descriptor,
    id: `ling-desktop-host#lingWorkspaceTerminals/${original.method}`,
    service: 'lingWorkspaceTerminals', namespace: 'lingWorkspaceTerminals',
    parameters: original.parameters.map((parameter, index) => index === 0
      ? { name: 'workspaceId', wire: 'workspaceId', source: 'json' as const, codec: parameter.codec }
      : parameter),
  }
})

export const LING_WORKSPACE_TERMINAL_REMOTE: TypertRemoteContribution = {
  package: 'ling-desktop-host/workspace-terminals', descriptors: WORKSPACE_TERMINAL_DESCRIPTORS,
}
export const LING_WORKSPACE_TERMINAL_HOST: TypertContribution = {
  package: 'ling-desktop-host/workspace-terminals', face: 'host', schemas: [], invocations: WORKSPACE_TERMINAL_DESCRIPTORS,
  model: { services: [{ key: 'lingWorkspaceTerminals', exportName: 'LingWorkspaceTerminalsController',
    summary: 'Workspace-owned user terminals, independent of conversations.', tags: [], members: [], types: [] }], events: [], objects: [] },
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { lingWorkspaceTerminals: LingWorkspaceTerminalRemote }
}
