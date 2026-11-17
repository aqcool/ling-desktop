export const desktopServerOpsModule = {
  id: "desktop-server-ops",
  requires: ["desktop", "server", "shared"],
  provides: ["desktop-server-ops"],
  publicEntrypoints: ["index.ts"],
} as const;
