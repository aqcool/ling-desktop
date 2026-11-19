import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const maxReferenceBytes = 15 * 1024 * 1024;
const sharedArgs = {
  prompt: { type: "string", description: "Describe the image or the changes to make." },
  transparentBackground: { type: "boolean", description: "Ask for a transparent PNG background." },
};
const tool = (name, description, properties, required) => ({
  name,
  description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
});
const tools = [
  tool("generate", "Generate one PNG image using the signed-in ChatGPT subscription.", sharedArgs, ["prompt"]),
  tool("edit", "Edit a PNG, JPEG, or WebP file in the active workspace using ChatGPT.", {
    ...sharedArgs,
    imagePath: { type: "string", description: "Path to the reference image in the active workspace." },
  }, ["prompt", "imagePath"]),
];

function requireInside(root, path) {
  const suffix = relative(root, path);
  if (!suffix || suffix === ".." || suffix.startsWith(".." + sep) || isAbsolute(suffix)) {
    throw new Error("Image files must be inside the active workspace.");
  }
}

function detectImage(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  throw new Error("Use a PNG, JPEG, or WebP reference image.");
}

async function readReference(root, input, signal) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Choose a reference image.");
  const file = await realpath(resolve(root, input));
  requireInside(root, file);
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxReferenceBytes) {
      throw new Error("Choose a regular image file of up to 15 MB.");
    }
    const bytes = Buffer.alloc(stat.size + 1);
    const read = await handle.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== stat.size) throw new Error("The reference image changed. Try again.");
    signal.throwIfAborted();
    const image = bytes.subarray(0, read.bytesRead);
    return `data:${detectImage(image)};base64,${image.toString("base64")}`;
  } finally {
    await handle.close();
  }
}

async function saveImage(directory, data, signal) {
  const path = join(directory, `${randomUUID()}.png`);
  signal.throwIfAborted();
  const file = await open(path, "wx");
  try {
    try {
      await file.writeFile(Buffer.from(data, "base64"));
      signal.throwIfAborted();
    } finally {
      await file.close();
    }
    return path;
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}

export async function main(bridgeConfig = process.env.ZCODE_IMAGEGEN_BRIDGE) {
  const bridge = bridgeConfig ? JSON.parse(bridgeConfig) : undefined;
  const server = new Server({ name: "imagegen", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: bridge ? tools : [] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
    try {
      if (!bridge) throw new Error("Image generation requires a local LING Desktop workspace.");
      if (params.name !== "generate" && params.name !== "edit") throw new Error("Unknown image tool.");
      const { prompt, transparentBackground, imagePath } = params.arguments ?? {};
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 32000)
        throw new Error("Provide an image prompt of up to 32,000 characters.");
      const workspace = params._meta?.workspace_path ?? process.env.ZCODE_PROJECT_DIR;
      if (typeof workspace !== "string" || !isAbsolute(workspace))
        throw new Error("Open a workspace to generate an image.");
      const root = await realpath(workspace);
      const image = params.name === "edit" ? await readReference(root, imagePath, signal) : undefined;
      const result = await fetch(bridge.url, {
        method: "POST",
        headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          prompt, transparentBackground, image, turnId: params._meta?.turn_id,
        }),
        redirect: "error",
        signal,
      });
      const { data, error } = await result.json();
      if (!result.ok || typeof data !== "string") throw new Error(error ?? "Image generation failed.");
      signal.throwIfAborted();
      const output = join(root, "generated_images");
      await mkdir(output, { recursive: true });
      const directory = await realpath(output);
      requireInside(root, directory);
      const path = await saveImage(directory, data, signal);
      const previewPath = relative(root, path).split(sep).join("/");
      return {
        content: [
          { type: "image", mimeType: "image/png", data },
          {
            type: "text",
            text: `Saved the PNG to ${path}\nPreview: ![Generated image](./${previewPath})`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "Image generation failed." }],
      };
    }
  });
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
