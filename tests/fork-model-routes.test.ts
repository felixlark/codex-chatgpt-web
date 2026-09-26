import { expect, test } from "bun:test";
import {
  availableChatGptWebModelRoutes,
  CHATGPT_WEB_LEGACY_MODEL_ROUTES,
  requireChatGptWebModelRoute,
  type ChatGptWebAutomaticModelRoute,
} from "../src/chatgpt-web-models";

const capabilities = {
  browserInteractionMode: "automatic" as const,
  solAvailable: true,
  extraHighAvailable: true,
  proAvailable: true,
  localToolsEnabled: true,
};

test("pre-6.0 fork Sol slugs still resolve, now through the 5.6 family", () => {
  for (const [slug, effort] of [
    ["chatgpt-web/sol-medium", "medium"], ["chatgpt-web/sol-high", "high"],
    ["chatgpt-web/sol-extra-high", "xhigh"], ["chatgpt-web/sol-pro", "max"],
  ] as const) {
    const route = requireChatGptWebModelRoute(slug, capabilities as never) as ChatGptWebAutomaticModelRoute;
    expect(route.modelFamily).toBe("5.6");
    expect(route.adapterEffort).toBe(effort);
    expect(route.legacy).toBe(true);
  }
});

test("legacy effort slugs hold Latest so a Sol task cannot leave them on Sol", () => {
  for (const route of CHATGPT_WEB_LEGACY_MODEL_ROUTES) expect(route.modelFamily).toBe("6");
  expect((requireChatGptWebModelRoute("chatgpt-web/high", capabilities as never) as ChatGptWebAutomaticModelRoute)
    .modelFamily).toBe("6");
});

test("the Sol aliases route by slug but stay out of the model catalog, as before 6.0", () => {
  const catalog = availableChatGptWebModelRoutes(capabilities as never, true).map(route => route.slug);
  expect(catalog).not.toContain("chatgpt-web/sol-high");
});
