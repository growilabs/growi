// --- Mock boundary ---------------------------------------------------------
//
// modelConfigSync is a thin S2sMessageHandlable adapter over a single
// collaborator: clearResolvedMastraModelCache(). The observable contract is
//   - shouldHandleS2sMessage: true iff eventName === 'configUpdated'
//   - handleS2sMessage: invokes clearResolvedMastraModelCache()
// We mock that collaborator so the test exercises only this module's routing
// behavior, not how the cache is actually cleared.
const { clearResolvedMastraModelCache } = vi.hoisted(() => ({
  clearResolvedMastraModelCache: vi.fn(),
}));

vi.mock('./ai-sdk-modules/resolve-mastra-model', () => ({
  clearResolvedMastraModelCache,
}));

import { mock } from 'vitest-mock-extended';

import type S2sMessage from '~/server/models/vo/s2s-message';

import { modelConfigSync } from './model-config-sync';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('modelConfigSync.shouldHandleS2sMessage (Req 2.4)', () => {
  it('returns true for a configUpdated message', () => {
    const s2sMessage = mock<S2sMessage>({ eventName: 'configUpdated' });

    expect(modelConfigSync.shouldHandleS2sMessage(s2sMessage)).toBe(true);
  });

  it('returns false for an unrelated event name', () => {
    const s2sMessage = mock<S2sMessage>({ eventName: 'mailServiceUpdated' });

    expect(modelConfigSync.shouldHandleS2sMessage(s2sMessage)).toBe(false);
  });

  it('handles configUpdated unconditionally — no freshness/dedup guard', () => {
    // Unlike ConfigManager, there is no updatedAt gate: over-invalidation is
    // acceptable because clearing the cache only forces a one-time rebuild on
    // the next request and is idempotent. Two configUpdated messages both route
    // to the handler.
    const first = mock<S2sMessage>({ eventName: 'configUpdated' });
    const second = mock<S2sMessage>({ eventName: 'configUpdated' });

    expect(modelConfigSync.shouldHandleS2sMessage(first)).toBe(true);
    expect(modelConfigSync.shouldHandleS2sMessage(second)).toBe(true);
  });
});

describe('modelConfigSync.handleS2sMessage (Req 2.4)', () => {
  it('clears the resolved Mastra model cache', async () => {
    await modelConfigSync.handleS2sMessage();

    expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
  });
});
