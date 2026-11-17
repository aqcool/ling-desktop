import { isRetiredOfficialPlugin, ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID } from "./plugin-marketplaces.js";

export function isPluginStoreVisible(pluginId: string): boolean {
  return !isRetiredOfficialPlugin(pluginId);
}
const NODE_REPL_HOST_PLUGIN_ID = `node-repl-host@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID}`;
export function isUserFacingPlugin(pluginId: string): boolean {
  return pluginId !== NODE_REPL_HOST_PLUGIN_ID;
}
export function isDiscoverableOfficialPlugin(pluginId: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]*@zcode-plugins-official$/u.test(pluginId) &&
    isUserFacingPlugin(pluginId) &&
    isPluginStoreVisible(pluginId)
  );
}
