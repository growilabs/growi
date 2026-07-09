// --- Mock boundary ---------------------------------------------------------
//
// modelConfigSync is a thin S2sMessageHandlable adapter over two collaborators:
// clearResolvedMastraModelCache() and clearAvailabilityLogDedup(). The observable
// contract is
//   - shouldHandleS2sMessage: true iff eventName === 'configUpdated'
//   - handleS2sMessage: invokes BOTH resets (mirroring the local PUT-handler path)
// We mock those collaborators so the test exercises only this module's routing
// behavior, not how the cache / dedup registry are actually reset.
const { clearResolvedMastraModelCache, clearAvailabilityLogDedup } = vi.hoisted(
  () => ({
    clearResolvedMastraModelCache: vi.fn(),
    clearAvailabilityLogDedup: vi.fn(),
  }),
);

vi.mock('./ai-sdk-modules/resolve-mastra-model', () => ({
  clearResolvedMastraModelCache,
}));
vi.mock('./ai-sdk-modules/llm-providers/warn-dedup', () => ({
  clearAvailabilityLogDedup,
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

describe('modelConfigSync.handleS2sMessage (Req 2.4, 6.1)', () => {
  it('clears the resolved Mastra model cache', async () => {
    await modelConfigSync.handleS2sMessage();

    expect(clearResolvedMastraModelCache).toHaveBeenCalledTimes(1);
  });

  it('resets the availability/malformed-config log dedup so a remote config change re-notifies (Req 6.1)', async () => {
    // Without this, a non-publishing instance keeps its dedup registry and never
    // re-emits a still-present misconfiguration warn after a cluster config change.
    await modelConfigSync.handleS2sMessage();

    expect(clearAvailabilityLogDedup).toHaveBeenCalledTimes(1);
  });
});
