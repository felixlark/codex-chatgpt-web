import {
  CHATGPT_WEB_BACKEND_MODEL,
  CHATGPT_WEB_LUNA_BACKEND_MODEL,
} from "../../chatgpt-web-models";

export const CHATGPT_WEB_MODEL_ID = CHATGPT_WEB_BACKEND_MODEL;
export const CHATGPT_WEB_LUNA_MODEL_ID = CHATGPT_WEB_LUNA_BACKEND_MODEL;

export interface ChatGptWebCapabilities {
  localToolsEnabled: boolean;
  solAvailable: boolean;
  extraHighAvailable: boolean;
  proAvailable: boolean;
}

export interface ChatGptWebModelMode {
  modelId: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  displayLabel: "Luna" | "Think" | "Instant" | "Medium" | "High" | "Extra High" | "Pro";
  uiEffortIndex: 0 | 1 | 2 | 3 | 4 | null;
  thinkEnabled: boolean;
  /**
   * The ChatGPT model item to hold in the intelligence picker: "latest" (the picker's default,
   * currently GPT-6) or "sol" (GPT-5.6 Sol). Undefined for Luna, which has no picker.
   */
  webModel?: ChatGptWebPickerModel;
  localTools: boolean;
}

export type ChatGptWebPickerModel = "latest" | "sol";

/** `high` selects Latest at High; `high@sol` selects GPT-5.6 Sol at High. */
export function splitChatGptWebReasoning(reasoning: string | undefined): { effort: string | undefined; webModel: ChatGptWebPickerModel } {
  if (reasoning === undefined) return { effort: undefined, webModel: "latest" };
  const at = reasoning.indexOf("@");
  if (at < 0) return { effort: reasoning, webModel: "latest" };
  const suffix = reasoning.slice(at + 1);
  if (suffix !== "sol") throw new Error(`ChatGPT web model variant is not supported: ${suffix}`);
  return { effort: reasoning.slice(0, at), webModel: "sol" };
}

export function resolveChatGptWebModelMode(
  modelId: string,
  reasoning: string | undefined,
  capabilities: ChatGptWebCapabilities,
): ChatGptWebModelMode {
  if (modelId === CHATGPT_WEB_LUNA_MODEL_ID) {
    if (capabilities.solAvailable) {
      throw new Error("ChatGPT Luna is not available while the account exposes the Sol model selector");
    }
    const effort = reasoning ?? "low";
    if (effort !== "low" && effort !== "medium") {
      throw new Error(`ChatGPT Luna mode is not supported: ${effort}`);
    }
    const thinkEnabled = effort === "medium";
    return {
      modelId,
      effort,
      displayLabel: thinkEnabled ? "Think" : "Luna",
      uiEffortIndex: null,
      thinkEnabled,
      localTools: capabilities.localToolsEnabled,
    };
  }
  if (modelId !== CHATGPT_WEB_MODEL_ID) {
    throw new Error(`ChatGPT web model is not supported: ${modelId}`);
  }
  if (!capabilities.solAvailable) {
    throw new Error("ChatGPT Sol modes are not available for this Luna-only account");
  }
  const split = splitChatGptWebReasoning(reasoning);
  const effort = split.effort ?? "high";
  const webModel = split.webModel;
  switch (effort) {
    case "low":
      return { modelId, effort, displayLabel: "Instant", uiEffortIndex: 0, thinkEnabled: false, localTools: capabilities.localToolsEnabled, webModel };
    case "medium":
      return { modelId, effort, displayLabel: "Medium", uiEffortIndex: 1, thinkEnabled: false, localTools: capabilities.localToolsEnabled, webModel };
    case "high":
      return { modelId, effort, displayLabel: "High", uiEffortIndex: 2, thinkEnabled: false, localTools: capabilities.localToolsEnabled, webModel };
    case "xhigh":
      if (!capabilities.extraHighAvailable) throw new Error("ChatGPT Extra High effort is not available for this account");
      return { modelId, effort, displayLabel: "Extra High", uiEffortIndex: 3, thinkEnabled: false, localTools: capabilities.localToolsEnabled, webModel };
    case "max":
      if (!capabilities.proAvailable) throw new Error("ChatGPT Pro effort is not available for this account");
      return { modelId, effort, displayLabel: "Pro", uiEffortIndex: 4, thinkEnabled: false, localTools: capabilities.localToolsEnabled, webModel };
    default:
      throw new Error(`ChatGPT web effort is not supported: ${effort}`);
  }
}
