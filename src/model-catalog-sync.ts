import type { AppConfig } from "./config";
import { defaultConfig } from "./config";
import { availableChatGptWebModelRoutes, chatGptWebRouteEfforts } from "./chatgpt-web-models";
import { augmentNativeModelCatalog } from "./model-catalog";

/** Non-secret, runtime-owned contract for clients whose Codex catalog is bundled or cached. */
export function webCatalogDescriptor(config: AppConfig) {
  const capabilities = {
    mode: config.mode,
    zeroRiskProEnabled: config.zeroRiskProEnabled,
    solAvailable: config.solAvailable,
    proAvailable: config.proAvailable,
    extraHighAvailable: config.extraHighAvailable,
    experimentalBiggerContext: config.experimentalBiggerContext,
    browserInteractionMode: config.browserInteractionMode,
    subagentProtocol: config.subagentProtocol,
  };
  return {
    schema: 1,
    capabilities,
    models: availableChatGptWebModelRoutes(config, true).map(route => ({
      slug: route.slug, display_name: route.displayName, description: route.description,
      visibility: route.legacy ? "hide" : "list", efforts: chatGptWebRouteEfforts(route, config),
    })),
  };
}

export function synchronizeModelCatalog(native: unknown, descriptor: unknown) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) throw Error("Missing Gateway catalog descriptor");
  const remote = descriptor as ReturnType<typeof webCatalogDescriptor>;
  if (remote.schema !== 1 || !remote.capabilities || !Array.isArray(remote.models)) throw Error("Unsupported Gateway catalog descriptor");
  const c = remote.capabilities;
  if (!["full", "browser-only"].includes(c.mode)
    || !["automatic", "manual"].includes(c.browserInteractionMode)
    || !["compatibility-v1", "native"].includes(c.subagentProtocol)
    || [c.solAvailable, c.proAvailable, c.extraHighAvailable, c.experimentalBiggerContext, c.zeroRiskProEnabled].some(value => typeof value !== "boolean")) {
    throw Error("Invalid Gateway catalog capabilities");
  }
  const allowed = Object.keys(webCatalogDescriptor(defaultConfig(c.mode)).capabilities);
  if (Object.keys(c).some(key => !allowed.includes(key))) throw Error("Unexpected Gateway catalog capability");
  const config = Object.assign(defaultConfig(c.mode), {
    mode: c.mode, zeroRiskProEnabled: c.zeroRiskProEnabled, solAvailable: c.solAvailable,
    proAvailable: c.proAvailable, extraHighAvailable: c.extraHighAvailable,
    experimentalBiggerContext: c.experimentalBiggerContext, browserInteractionMode: c.browserInteractionMode,
    subagentProtocol: c.subagentProtocol,
  });
  const expected = webCatalogDescriptor(config);
  // Fail closed on runtime/source drift instead of manufacturing stale labels or routes.
  if (JSON.stringify(remote.models) !== JSON.stringify(expected.models)) throw Error("Gateway model contract changed; integrate its upstream before synchronizing");
  if (!expected.models.some(row => row.visibility === "list")) throw Error("Gateway advertises no visible CCW models");
  return augmentNativeModelCatalog(native, config);
}
