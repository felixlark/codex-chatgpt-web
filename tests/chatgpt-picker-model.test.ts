import { describe, expect, test } from "bun:test";
import { holdChatGptPickerModel } from "../src/adapters/chatgpt-web/browser-worker";
import { resolveChatGptWebModelMode, splitChatGptWebReasoning } from "../src/adapters/chatgpt-web/model";
import { CHATGPT_WEB_MODEL_ROUTES, CHATGPT_WEB_SOL_MODEL_ROUTES, requireChatGptWebModelRoute } from "../src/chatgpt-web-models";

function picker(labels: string[], checkedIndex: number) {
  const state = { checked: checkedIndex, clicks: [] as number[] };
  const items = {
    count: async () => labels.length,
    nth: (index: number) => ({
      innerText: async () => labels[index]!,
      getAttribute: async (name: string) => (name === "aria-checked" ? String(state.checked === index) : null),
      isVisible: async () => true,
      click: async () => { state.clicks.push(index); state.checked = index; },
    }),
  };
  return { state, menu: { locator: () => items } as never };
}

const capabilities = { solAvailable: true, extraHighAvailable: true, proAvailable: true, localToolsEnabled: true };
const LABELS = ["Latest", "GPT-5.6 Sol", "GPT-5.5 Leaving on October 14"];

describe("ChatGPT picker model", () => {
  test("an effort alone means Latest; @sol means GPT-5.6 Sol", () => {
    expect(splitChatGptWebReasoning("high")).toEqual({ effort: "high", webModel: "latest" });
    expect(splitChatGptWebReasoning("max@sol")).toEqual({ effort: "max", webModel: "sol" });
    expect(() => splitChatGptWebReasoning("high@luna")).toThrow("variant");
    expect(resolveChatGptWebModelMode("gpt-5.6-sol", "xhigh@sol", capabilities as never))
      .toMatchObject({ effort: "xhigh", uiEffortIndex: 3, webModel: "sol" });
  });

  test("Sol routes are routable by slug but not in the advertised catalog", () => {
    expect(CHATGPT_WEB_MODEL_ROUTES.map(route => route.slug)).not.toContain("chatgpt-web/sol-high");
    expect(CHATGPT_WEB_SOL_MODEL_ROUTES.map(route => route.adapterEffort))
      .toEqual(["medium@sol", "high@sol", "xhigh@sol", "max@sol"]);
    expect(requireChatGptWebModelRoute("chatgpt-web/sol-pro", capabilities as never).adapterEffort).toBe("max@sol");
  });

  test("holds Sol when asked, leaves Latest alone when it is already held", async () => {
    const sol = picker(LABELS, 0);
    expect(await holdChatGptPickerModel(sol.menu, "sol")).toBe(true);
    expect(sol.state.clicks).toEqual([1]);
    const latest = picker(LABELS, 0);
    expect(await holdChatGptPickerModel(latest.menu, "latest")).toBe(false);
    expect(latest.state.clicks).toEqual([]);
  });

  test("a default turn moves the picker back to Latest after a Sol run", async () => {
    const back = picker(LABELS, 1);
    expect(await holdChatGptPickerModel(back.menu, "latest")).toBe(true);
    expect(back.state.clicks).toEqual([0]);
  });

  test("without a model list Latest turns carry on, while a Sol request fails", async () => {
    const none = picker([], -1);
    expect(await holdChatGptPickerModel(none.menu, "latest")).toBe(false);
    await expect(holdChatGptPickerModel(none.menu, "sol")).rejects.toThrow("model controls are unavailable");
  });
});
