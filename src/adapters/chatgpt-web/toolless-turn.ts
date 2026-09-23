/**
 * A ChatGPT message that reaches the model without its connector — or whose turn binding was
 * revoked while the model was thinking — comes back as a polite paragraph explaining that no local
 * Codex tools were available. Codex accepts that as the turn's answer, so a scarce prompt buys
 * nothing and the goal transcript fills up with restatements of old evidence. A third of the iOS
 * thread's turns were this (2026-09-23 review).
 *
 * The answer alone is not enough to judge: a turn may legitimately end without tools. Pair these
 * phrases with the broker's count of tool calls actually made.
 */
const NO_TOOLS = [
  /turn token is invalid, expired, or revoked/i,
  /no (?:available |usable )?local Codex/i,
  /local Codex (?:Native )?(?:tools|harness) (?:are|is) (?:not available|unavailable)/i,
  /(?:未提供|没有|无)(?:可用的)?本地\s*Codex/,
  /本地\s*Codex[^。]{0,24}(?:不可用|无法(?:调用|访问|执行))/,
  /(?:执行通道|执行入口|工具侧)[^。]{0,16}(?:拒绝|拦截|不可用|无法)/,
];

export function chatGptAnsweredWithoutTools(answer: string): boolean {
  return NO_TOOLS.some(pattern => pattern.test(answer));
}
