/**
 * ChatGPT binds a connector to one message, so a retained Temporary Chat's follow-up reaches a
 * model without tools, and the connector cannot be selected again there. The browser worker
 * detects that and the turn runs again on a fresh chat, but every later turn of the same thread
 * paid for the same doomed attempt (249 of them on Mars in one day, all failing).
 *
 * Remember which threads proved it, and stop retaining their conversations. If ChatGPT ever keeps
 * the connector again, a restarted bridge goes back to retaining.
 */
const lostConnectorThreads = new Set<string>();

export function noteChatGptRetainedConnectorLost(threadId: string | undefined): void {
  if (threadId) lostConnectorThreads.add(threadId);
}

export function chatGptRetainedConversationUsable(threadId: string | undefined): boolean {
  return !threadId || !lostConnectorThreads.has(threadId);
}

/** Tests only: the registry lives for the process, like the browser hosts it describes. */
export function resetChatGptRetainedConversationHealthForTests(): void {
  lostConnectorThreads.clear();
}
