import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";

const app = new App(
  { name: "Server picker", version: "0.1.5" },
  { availableDisplayModes: ["inline"] },
  { autoResize: false },
);
const element = (id) => document.getElementById(id);
const picker = element("picker");
const servers = element("servers");
const status = element("status");
let profiles = [];
let selected = new Set();
let saving = false;

const chinese = {
  loading: "正在读取 SSH 连接…",
  empty: "暂无 SSH 连接",
  emptyHint: "在「设置 → 远程设备」中添加",
  loadFailed: "无法读取服务器列表。",
  saveFailed: "无法保存服务器关联。",
};
const english = {
  loading: "Loading SSH connections…",
  empty: "No saved SSH connections",
  emptyHint: "Add one in Settings → Remote Devices",
  loadFailed: "Could not load servers.",
  saveFailed: "Could not save the server selection.",
};
let text = english;

async function call(name, args = {}) {
  const reply = await app.callServerTool({ name, arguments: args });
  if (reply.isError) {
    throw new Error(reply.content?.find((item) => item.type === "text")?.text);
  }
  return reply.structuredContent;
}

function showError(message = "") {
  status.textContent = message;
  status.hidden = !message;
}

function applyAppearance() {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
}

function publishCount() {
  if (!app.getHostCapabilities()?.experimental?.["zcode/widgetState"]) return;
  void app
    .request(
      { method: "ui/set-widget-state", params: { widgetState: { badge: selected.size } } },
      EmptyResultSchema,
    )
    .catch(() => {});
}

async function toggle(id, box) {
  if (saving) return;
  saving = true;
  showError();
  const next = new Set(selected);
  if (box.checked) next.add(id);
  else next.delete(id);
  const inputs = servers.querySelectorAll("input");
  for (const input of inputs) input.disabled = true;
  try {
    const result = await call("picker_save", { serverIds: [...next] });
    selected = new Set(result.serverIds);
    publishCount();
  } catch {
    box.checked = selected.has(id);
    showError(text.saveFailed);
  } finally {
    saving = false;
    for (const input of inputs) input.disabled = false;
    box.focus();
  }
}

function render() {
  element("empty").hidden = profiles.length > 0;
  servers.replaceChildren();
  for (const profile of profiles) {
    const label = document.createElement("label");
    label.className = "server";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(profile.id);
    box.onchange = () => void toggle(profile.id, box);
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "server-name";
    name.textContent = profile.name;
    name.title = profile.name;
    label.append(box, mark, name);
    servers.append(label);
  }
}

async function start() {
  app.onhostcontextchanged = applyAppearance;
  await app.connect();
  text = app.getHostContext()?.locale?.startsWith("zh") ? chinese : english;
  document.documentElement.lang = text === chinese ? "zh-CN" : "en";
  applyAppearance();
  element("empty-title").textContent = text.empty;
  element("empty-hint").textContent = text.emptyHint;

  new ResizeObserver(() => {
    const height = Math.ceil(picker.getBoundingClientRect().height);
    if (height > 0) void app.sendSizeChanged({ height });
  }).observe(picker);

  const loading = element("loading");
  loading.textContent = text.loading;
  try {
    const result = await call("picker_read");
    profiles = result.profiles;
    selected = new Set(result.serverIds);
    render();
    publishCount();
  } finally {
    loading.hidden = true;
  }
}

void start().catch(() => showError(text.loadFailed));
