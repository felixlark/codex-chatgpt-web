import { expect, test } from 'bun:test';
import { ChatGptDomFailureConfirmation, ChatGptTurnDomHealthTracker } from '../src/adapters/chatgpt-web/browser-worker';

test('a stale missing-final verdict is discarded when the fresh bound response has completion controls', () => {
  const health = new ChatGptTurnDomHealthTracker(1, 1, 1);
  const gate = new ChatGptDomFailureConfirmation();
  const stale = { responsePresent: true, running: false, currentText: '', completionActionVisible: false };
  health.update(stale, 0);
  const error = health.update(stale, 2);
  expect(error).toContain('without a final answer');
  expect(gate.confirm(error)).toBeFalse();
  const fresh = { ...stale, currentText: 'Bound final answer', completionActionVisible: true };
  expect(health.update(fresh, 3)).toBeUndefined();
  expect(gate.confirm(undefined)).toBeFalse();
  expect(gate.confirm(error)).toBeFalse();
});

test('a persistent failure is confirmed on the next fresh observation without resetting its deadline', () => {
  const gate = new ChatGptDomFailureConfirmation();
  expect(gate.confirm('missing final')).toBeFalse();
  expect(gate.confirm('missing final')).toBeTrue();
});

test('new tool or generation progress clears the pending failure rather than accepting an answer', () => {
  const gate = new ChatGptDomFailureConfirmation();
  expect(gate.confirm('missing final')).toBeFalse();
  expect(gate.confirm(undefined)).toBeFalse();
  expect(gate.confirm('missing final')).toBeFalse();
  expect(gate.confirm('missing final')).toBeTrue();
});
