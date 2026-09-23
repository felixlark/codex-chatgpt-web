import { expect, test, afterEach } from "bun:test";
import {
  chatGptRetainedConversationUsable,
  noteChatGptRetainedConnectorLost,
  resetChatGptRetainedConversationHealthForTests,
} from "../src/adapters/chatgpt-web/retained-conversation-health";

afterEach(() => resetChatGptRetainedConversationHealthForTests());

test("a thread stops retaining its conversation once ChatGPT dropped the connector", () => {
  expect(chatGptRetainedConversationUsable("thread_a")).toBe(true);
  noteChatGptRetainedConnectorLost("thread_a");
  expect(chatGptRetainedConversationUsable("thread_a")).toBe(false);
  expect(chatGptRetainedConversationUsable("thread_b")).toBe(true);   // only the thread that proved it
  expect(chatGptRetainedConversationUsable(undefined)).toBe(true);
});
