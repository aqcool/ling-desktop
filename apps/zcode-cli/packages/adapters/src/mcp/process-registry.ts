const BUILTIN_NODE_REPL_SERVER_NAME = "node_repl";
const PLUGIN_MCP_NAMESPACE_PREFIX = "plugin:";

type McpProcessSource = "builtin" | "plugin" | "custom";

/**
 * 资源管理器用的 MCP 子进程视图：只回 pid 与归属，不含任何采样值。
 * 这里保留明文 serverName / pluginName——只在本机 host ↔ CLI 之间流转，
 * 不出本机，无需脱敏；Host 用它把 ps 进程树上的 pid 归到具体插件。
 */
export interface McpTrackedProcess {
  pid: number;
  serverName: string;
  mcpSource: McpProcessSource;
  /** `plugin:<name>:<key>` 命名空间里的插件名；builtin host MCP（node_repl）由调用方按官方插件表补齐 */
  pluginName?: string;
}

export interface McpProcessRegistry {
  recordProcessClosed(input: { connectionId: string }): void;
  recordProcessStarted(input: { connectionId: string; pid: number }): void;
  registerConnection(input: {
    connectionId: string;
    serverName: string;
    source?: McpProcessSource;
  }): void;
  unregisterConnection(input: { connectionId: string }): void;
  /** 当前仍有存活进程记录的 MCP 连接（纯内存，无 I/O） */
  listProcesses(): McpTrackedProcess[];
}

interface TrackedConnection {
  mcpSource: McpProcessSource;
  serverName: string;
  pid?: number;
}

export function createMcpProcessRegistry(): McpProcessRegistry {
  const connections = new Map<string, TrackedConnection>();
  return {
    recordProcessClosed(input) {
      const connection = connections.get(input.connectionId);
      if (!connection) return;
      connection.pid = undefined;
    },
    recordProcessStarted(input) {
      const connection = connections.get(input.connectionId);
      if (!connection) return;
      connection.pid = input.pid;
    },
    registerConnection(input) {
      const mcpSource = input.source ?? resolveMcpSource(input.serverName);
      connections.set(input.connectionId, {
        mcpSource,
        serverName: input.serverName,
      });
    },
    unregisterConnection(input) {
      connections.delete(input.connectionId);
    },
    listProcesses() {
      const processes: McpTrackedProcess[] = [];
      for (const connection of connections.values()) {
        if (connection.pid === undefined) continue;
        const pluginName = resolvePluginName(connection.serverName);
        processes.push({
          pid: connection.pid,
          serverName: connection.serverName,
          mcpSource: connection.mcpSource,
          ...(pluginName ? { pluginName } : {}),
        });
      }
      return processes;
    },
  };
}

/** `plugin:<name>:<key>` → `<name>`；非插件命名空间返回 undefined */
export function resolvePluginName(serverName: string): string | undefined {
  if (!serverName.startsWith(PLUGIN_MCP_NAMESPACE_PREFIX)) return undefined;
  const name = serverName.slice(PLUGIN_MCP_NAMESPACE_PREFIX.length).split(":")[0]?.trim();
  return name ? name : undefined;
}

function resolveMcpSource(serverName: string): McpProcessSource {
  if (serverName === BUILTIN_NODE_REPL_SERVER_NAME) return "builtin";
  return serverName.startsWith(PLUGIN_MCP_NAMESPACE_PREFIX) ? "plugin" : "custom";
}
