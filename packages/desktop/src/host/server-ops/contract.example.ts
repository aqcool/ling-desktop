import type { z } from "zod";
import type { requestSchema } from "./contract.js";

export const serverListRequest: z.infer<typeof requestSchema> = {
  action: "server_list",
  sessionId: "session-1",
  workspacePath: "/workspace",
  args: {},
};
