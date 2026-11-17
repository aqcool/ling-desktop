import type { Logger } from "@zcode/contracts";
import { startCliMemoryDiagnostics } from "@zcode/adapters/memory-diagnostics";
import { createMemorySampleWriteGate, memoryUsageToSampleFields, type MemorySample } from "@zcode/shared";
import type { ZCodeProtocolAgentServer } from "./server.js";

const MAINTENANCE_INTERVAL_MS = 60_000;

export function startProtocolMaintenance(server: ZCodeProtocolAgentServer, logger: Logger): {
  stop(): void;
} {
  const memoryDiagnosticsGate = createMemorySampleWriteGate();
  const maintenance = setInterval(() => {
    try {
      server.rebalanceResidentSessions();
      server.pruneSessionEventStores();
      server.pruneDetachedChildPublishers();
      const sample: MemorySample = {
        role: "agent_node",
        ...memoryUsageToSampleFields(process.memoryUsage()),
        counters: server.collectMemoryDiagnostics(),
      };
      const reason = memoryDiagnosticsGate.evaluate(sample, Date.now());
      if (reason) {
        const { role: _role, counters, ...memoryFields } = sample;
        logger.info("Process memory sample", {
          event: "zcode_protocol.process.memory_sample",
          reason,
          ...memoryFields,
          counters,
        });
      }
    } catch (error) {
      logger.warn("Periodic protocol maintenance failed", {
        event: "zcode_protocol.maintenance.failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }, MAINTENANCE_INTERVAL_MS);
  maintenance.unref();

  let diagnostics: { stop(): void } | undefined;
  try {
    diagnostics = startCliMemoryDiagnostics(() =>
      server.collectMemoryDiagnostics({ includeEventStats: false }),
    );
  } catch (error) {
    logger.warn("Could not start CLI memory diagnostics", {
      event: "zcode_protocol.memory_diagnostics.failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    stop() {
      clearInterval(maintenance);
      diagnostics?.stop();
    },
  };
}
