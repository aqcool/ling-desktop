import type { RemoteTarget } from "./remoteTarget.js";

export type RemoteUsageRemoteKind = RemoteTarget["kind"];
export type RemoteWorkspaceConnectTrigger = "new" | "reconnect" | "restore";
