import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { webCatalogDescriptor, synchronizeModelCatalog } from "../src/model-catalog-sync";

const native = { models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", description: "Current native description",
  visibility: "list", supported_in_api: true, tool_mode: "code_mode_only", multi_agent_version: "v2",
  supported_reasoning_levels: [{ effort: "medium", description: "Native Medium" }] }] };

test("runtime catalog restores CCW choices while preserving latest native descriptions", () => {
  const config = defaultConfig("full"); config.subagentProtocol = "native";
  config.proAvailable = true; config.extraHighAvailable = true;
  const snapshot = structuredClone(native);
  const descriptor = webCatalogDescriptor(config);
  expect(JSON.stringify(descriptor)).not.toContain(config.controlToken);
  const result = synchronizeModelCatalog(native, descriptor);
  const rows = result.models as Array<Record<string, unknown>>;
  expect(rows[0]).toEqual(native.models[0]); expect(native).toEqual(snapshot);
  const ccw = rows.find(row => row.slug === "chatgpt-web/gpt-5.6-sol")!;
  expect(ccw.visibility).toBe("list");
  expect(ccw.default_reasoning_level).toBe("medium");
  expect(ccw.supported_reasoning_levels).toMatchObject([{ effort: "medium" }, { effort: "high" }, { effort: "xhigh" }]);
  expect(rows.filter(row => String(row.slug).startsWith("chatgpt-web/") && row.visibility === "list").length).toBeGreaterThan(0);
});

test("changed runtime labels or schema cannot silently install an outdated catalog", () => {
  const descriptor = webCatalogDescriptor(defaultConfig("full"));
  descriptor.models[0]!.description = "new upstream contract";
  expect(() => synchronizeModelCatalog(native, descriptor)).toThrow("integrate its upstream");
  expect(() => synchronizeModelCatalog(native, { ...descriptor, schema: 2 })).toThrow("Unsupported");
});

test("missing account capabilities cannot advertise models from a guessed profile", () => {
  const descriptor = webCatalogDescriptor(defaultConfig("full"));
  expect(() => synchronizeModelCatalog(native, { ...descriptor, capabilities: { ...descriptor.capabilities, proAvailable: undefined } })).toThrow("Invalid");
});

 test("unexpected remote settings cannot override the catalog profile", () => {
  const descriptor = webCatalogDescriptor(defaultConfig("full"));
  expect(() => synchronizeModelCatalog(native, { ...descriptor, capabilities: { ...descriptor.capabilities, controlToken: "injected" } })).toThrow("Unexpected");
  descriptor.capabilities.zeroRiskProEnabled = true;
  expect(synchronizeModelCatalog(native, descriptor).models).toBeDefined();
});
