import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const uri = "ui://server-ops/picker.html";
const resource = {
  uri,
  name: "Server picker",
  mimeType: "text/html;profile=mcp-app",
  _meta: {
    ui: { prefersBorder: false },
    "openai/widgetHeightHint": 28,
    "openai/widgetMinFrameHeight": 28,
  },
};
const string = { type: "string" };

function tool(name, description, properties = {}, required = [], options = {}) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    ...options,
  };
}

const appOnly = { _meta: { ui: { visibility: ["app"] } } };
const readOnly = { annotations: { readOnlyHint: true } };
const tools = [
  tool("open_server_picker", "Show the SSH server picker for this conversation.", {}, [], {
    ...readOnly,
    _meta: { ui: { resourceUri: uri, surface: "server-picker" } },
  }),
  tool("picker_read", "Read saved SSH profiles and the current selection.", {}, [], {
    ...appOnly,
    ...readOnly,
  }),
  tool(
    "picker_save",
    "Save the user's server selection.",
    {
      serverIds: { type: "array", items: string },
    },
    ["serverIds"],
    appOnly,
  ),
  tool("server_list", "List the SSH servers associated with this conversation.", {}, [], readOnly),
  tool(
    "remote_run",
    "Run a shell command on an associated SSH server.",
    {
      serverId: string,
      command: string,
    },
    ["serverId", "command"],
    { annotations: { destructiveHint: true } },
  ),
  tool(
    "server_copy",
    "Upload one workspace file to an exact absolute destination on an associated SSH server.",
    {
      serverId: string,
      source: string,
      destination: string,
      overwrite: { type: "string", enum: ["replace", "skip", "error"] },
    },
    ["serverId", "source", "destination"],
    { annotations: { destructiveHint: true } },
  ),
];

async function callHost({ url, token }, payload, signal) {
  const response = await new Promise((resolve, reject) => {
    const call = request(
      url,
      {
        method: "POST",
        agent: false,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        signal,
      },
      resolve,
    );
    call.once("error", reject);
    call.end(JSON.stringify(payload));
  });
  const body = [];
  for await (const chunk of response) body.push(chunk);
  const result = JSON.parse(Buffer.concat(body).toString("utf8"));
  if (response.statusCode !== 200) throw new Error(result.error);
  return result;
}

export async function main(bridgeConfig = process.env.ZCODE_SERVER_OPS_BRIDGE) {
  const bridge = bridgeConfig ? JSON.parse(bridgeConfig) : null;
  const server = new Server(
    { name: "server-ops", version: "0.1.5" },
    {
      capabilities: { tools: {}, resources: {} },
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: bridge ? tools : [] }));
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [resource] }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (params.uri !== uri) throw new Error("Unknown resource.");
    const text = await readFile(new URL("./picker.html", import.meta.url), "utf8");
    return { contents: [{ ...resource, text }] };
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
    try {
      if (!tools.some((entry) => entry.name === params.name))
        throw new Error("Unknown server tool.");
      if (params.name === "open_server_picker") {
        return { content: [{ type: "text", text: "Select servers for this conversation." }] };
      }
      if (!bridge) throw new Error("Server operations require LING Desktop.");
      const result = await callHost(
        bridge,
        {
          action: params.name,
          args: params.arguments ?? {},
          sessionId: params._meta?.root_session_id ?? params._meta?.session_id,
          workspacePath: params._meta?.workspace_path ?? process.cwd(),
        },
        extra.signal,
      );
      const picker = params.name.startsWith("picker_");
      return {
        content: [{ type: "text", text: picker ? "Server selection" : JSON.stringify(result) }],
        ...(picker ? { structuredContent: result } : {}),
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
