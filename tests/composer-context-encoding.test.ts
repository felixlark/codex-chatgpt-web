import { expect, test } from 'bun:test';
import { serializeChatGptContext, withoutRetiredTurnHandles } from '../src/adapters/chatgpt-web/prompt';

test('composer transport escapes Markdown only within JSON string tokens, with exact decoded context', () => {
  const value = { version: 3, system: ['<tool> **literal** [x](https://example.com)\n```ts\n[ref][missing] [{x:"<&>"}]\n```  中😀', '\\u005b literal escape, \\" quoted,\r\n'], messages: [{role:'user',content:'[pending] <not HTML>'}], '[key]': [null, true, 12] };
  const encoded = serializeChatGptContext(value);
  expect(JSON.parse(encoded)).toEqual(value);
  for (const token of encoded.match(/"(?:\\.|[^"\\])*"/g) ?? []) expect(token).not.toMatch(/[<>\[\]`]/);
  expect(encoded).toContain('"system":[');
  expect(encoded.length).toBeGreaterThan(JSON.stringify(value).length);
});

test('encoding preserves retired handle cleanup without losing its placeholder text', () => {
  const value = { text: 'request_' + 'x'.repeat(32) + '\n[ref][missing]' };
  expect(JSON.parse(serializeChatGptContext(value))).toEqual(JSON.parse(withoutRetiredTurnHandles(JSON.stringify(value))));
});
