import { z } from "zod";

export const requestSchema = z.object({
  action: z.enum(["picker_read", "picker_save", "server_list", "remote_run", "server_copy"]),
  sessionId: z.string().min(1),
  workspacePath: z.string().min(1),
  args: z.unknown(),
});
export const serverId = z.string().min(1);
export const serverArgs = z.object({ serverId });
export const copyArgs = z.object({
  serverId,
  source: z.string().min(1),
  destination: z.string().min(1),
  overwrite: z.enum(["replace", "skip", "error"]).default("error"),
});
