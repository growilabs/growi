import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBootstrapHeartbeat } from '../bootstrap-heartbeat';

// ---------------------------------------------------------------------------
// Mock VaultSyncState model — no real MongoDB needed
// ---------------------------------------------------------------------------

const mockUpdateOne = vi.fn();
const mockFindOne = vi.fn();

const mockVaultSyncState = {
  updateOne: mockUpdateOne,
  findOne: mockFindOne,
} as unknown as Parameters<
  typeof createBootstrapHeartbeat
>[0]['vaultSyncState'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_MS = 60_000;

function createHeartbeat(
  opts: { intervalMs?: number; staleThresholdMs?: number } = {},
) {
  return createBootstrapHeartbeat({
    vaultSyncState: mockVaultSyncState,
    intervalMs: opts.intervalMs ?? DEFAULT_INTERVAL_MS,
    staleThresholdMs: opts.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BootstrapHeartbeat', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // acquireInstance
  // -------------------------------------------------------------------------

  describe('acquireInstance()', () => {
    it('calls updateOne with a UUID and returns the instanceId', async () => {
      mockUpdateOne.mockResolvedValue({});

      const heartbeat = createHeartbeat();
      const { instanceId } = await heartbeat.acquireInstance();

      // Should look like a UUID v4
      expect(instanceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      // updateOne must have been called exactly once
      expect(mockUpdateOne).toHaveBeenCalledOnce();

      const [filter, update] = mockUpdateOne.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];

      // Filter targets the singleton document
      expect(filter).toEqual({ _id: 'singleton' });

      // Update sets bootstrapInstanceId to the returned instanceId
      expect(update.$set.bootstrapInstanceId).toBe(instanceId);

      // Update also sets bootstrapHeartbeatAt to a Date
      expect(update.$set.bootstrapHeartbeatAt).toBeInstanceOf(Date);
    });

    it('generates a different UUID on each call', async () => {
      mockUpdateOne.mockResolvedValue({});

      const heartbeat = createHeartbeat();
      const { instanceId: id1 } = await heartbeat.acquireInstance();
      const { instanceId: id2 } = await heartbeat.acquireInstance();

      expect(id1).not.toBe(id2);
    });
  });

  // -------------------------------------------------------------------------
  // refresh() + stop()
  // -------------------------------------------------------------------------

  describe('refresh() and stop()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockUpdateOne.mockResolvedValue({});
    });

    it('calls updateOne once after intervalMs has elapsed', async () => {
      const heartbeat = createHeartbeat({ intervalMs: 5_000 });
      heartbeat.refresh();

      // No tick yet
      expect(mockUpdateOne).not.toHaveBeenCalled();

      // Advance by one interval
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockUpdateOne).toHaveBeenCalledOnce();

      const [filter, update] = mockUpdateOne.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      expect(filter).toEqual({ _id: 'singleton' });
      expect(update.$set.bootstrapHeartbeatAt).toBeInstanceOf(Date);

      heartbeat.stop();
    });

    it('calls updateOne multiple times for multiple intervals', async () => {
      const heartbeat = createHeartbeat({ intervalMs: 1_000 });
      heartbeat.refresh();

      await vi.advanceTimersByTimeAsync(3_500);

      // Should have fired 3 times (at 1s, 2s, 3s)
      expect(mockUpdateOne).toHaveBeenCalledTimes(3);

      heartbeat.stop();
    });

    it('stop() prevents future ticks from triggering updateOne', async () => {
      const heartbeat = createHeartbeat({ intervalMs: 1_000 });
      heartbeat.refresh();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockUpdateOne).toHaveBeenCalledOnce();

      heartbeat.stop();
      mockUpdateOne.mockClear();

      // Advance further — no more calls
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });

    it('stop() is idempotent (calling twice does not throw)', () => {
      const heartbeat = createHeartbeat();
      heartbeat.refresh();
      heartbeat.stop();
      expect(() => heartbeat.stop()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // detectStaleRunning()
  // -------------------------------------------------------------------------

  describe('detectStaleRunning()', () => {
    it('returns true when state is running and heartbeat is older than staleThresholdMs', async () => {
      // Heartbeat was 2 minutes ago — stale w.r.t. 60 s threshold
      const twoMinutesAgo = new Date(Date.now() - 120_000);
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          bootstrapState: 'running',
          bootstrapHeartbeatAt: twoMinutesAgo,
        }),
      });

      const heartbeat = createHeartbeat({ staleThresholdMs: 60_000 });
      const result = await heartbeat.detectStaleRunning();

      expect(result).toBe(true);
    });

    it('returns false when state is not running', async () => {
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          bootstrapState: 'done',
          bootstrapHeartbeatAt: new Date(Date.now() - 120_000),
        }),
      });

      const heartbeat = createHeartbeat({ staleThresholdMs: 60_000 });
      const result = await heartbeat.detectStaleRunning();

      expect(result).toBe(false);
    });

    it('returns false when state is running but heartbeat is fresh', async () => {
      // Heartbeat written just now — definitely not stale
      const justNow = new Date();
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          bootstrapState: 'running',
          bootstrapHeartbeatAt: justNow,
        }),
      });

      const heartbeat = createHeartbeat({ staleThresholdMs: 60_000 });
      const result = await heartbeat.detectStaleRunning();

      expect(result).toBe(false);
    });

    it('returns true when state is running and bootstrapHeartbeatAt is null', async () => {
      // Null heartbeat with running state is always treated as stale
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          bootstrapState: 'running',
          bootstrapHeartbeatAt: null,
        }),
      });

      const heartbeat = createHeartbeat({ staleThresholdMs: 60_000 });
      const result = await heartbeat.detectStaleRunning();

      expect(result).toBe(true);
    });

    it('returns false when the singleton document does not exist', async () => {
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const heartbeat = createHeartbeat({ staleThresholdMs: 60_000 });
      const result = await heartbeat.detectStaleRunning();

      expect(result).toBe(false);
    });

    it('queries with the singleton _id filter', async () => {
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const heartbeat = createHeartbeat();
      await heartbeat.detectStaleRunning();

      expect(mockFindOne).toHaveBeenCalledWith({ _id: 'singleton' });
    });
  });
});
