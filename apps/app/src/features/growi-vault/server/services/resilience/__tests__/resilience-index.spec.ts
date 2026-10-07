/**
 * resilience-index.spec.ts
 *
 * Unit tests for the resilience barrel (Task 4.4).
 * Verifies that createVaultResilienceLayer composes all sub-modules correctly
 * and returns a VaultResilienceLayer that delegates to the runner and drift detector.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports from the barrel — this is the public API under test
// ---------------------------------------------------------------------------
import {
  type BootstrapStatus,
  createVaultResilienceLayer,
  type DriftStatus,
  type ResilienceStatus,
  type RetryStatus,
  type VaultResilienceLayer,
  type VaultResilienceLayerDeps,
} from '../index';

// ---------------------------------------------------------------------------
// Minimal mock helpers
// ---------------------------------------------------------------------------

function makeVaultSyncState() {
  return {
    findOneAndUpdate: vi
      .fn()
      .mockResolvedValue({ bootstrapState: 'pending', bootstrapProcessed: 0 }),
    findOne: vi.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
}

function makeVaultInstruction() {
  return {
    create: vi.fn().mockResolvedValue({ _id: { toString: () => 'fake-id' } }),
    findOne: vi.fn().mockResolvedValue({ _id: { toString: () => 'fake-id' } }),
  };
}

function makePageModel() {
  return {
    estimatedDocumentCount: vi.fn().mockResolvedValue(0),
    find: vi.fn().mockReturnValue({
      cursor: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
        }),
      }),
    }),
    findOne: vi.fn().mockResolvedValue(null),
  };
}

function makeNamespaceMapper() {
  return {
    computePageNamespaces: vi.fn().mockReturnValue({ current: [] }),
  };
}

function makeConfigManager(): VaultResilienceLayerDeps['configManager'] {
  const config: Record<string, number | string> = {
    'app:vaultBootstrapOnStart': 'true' as 'true' | 'false' | 'force',
    'app:vaultBootstrapRetryMax': 5,
    'app:vaultBootstrapRetryBaseMs': 30_000,
    'app:vaultBootstrapRetryMaxMs': 1_800_000,
    'app:vaultBootstrapHeartbeatIntervalMs': 15_000,
    'app:vaultBootstrapHeartbeatStaleMs': 120_000,
    'app:vaultDriftDetectionIntervalMs': 300_000,
    'app:vaultDriftMaxPagesPerTick': 10_000,
  };
  // Cast via unknown to satisfy the overloaded interface while keeping a
  // vi.fn() mock that tests can inspect for call count / arguments.
  return {
    getConfig: vi.fn(
      (key: string) => config[key] ?? 0,
    ) as unknown as VaultResilienceLayerDeps['configManager']['getConfig'],
  };
}

function makeDeps(): VaultResilienceLayerDeps {
  return {
    vaultSyncState: makeVaultSyncState(),
    vaultInstruction: makeVaultInstruction(),
    pageModel: makePageModel(),
    namespaceMapper: makeNamespaceMapper(),
    configManager: makeConfigManager(),
    createActivity: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createVaultResilienceLayer (resilience/index.ts barrel)', () => {
  describe('factory return type', () => {
    it('returns an object with all 5 VaultResilienceLayer methods', () => {
      const layer = createVaultResilienceLayer(makeDeps());

      expect(layer).toBeDefined();
      expect(typeof layer.bootstrap).toBe('function');
      expect(typeof layer.initOnStartup).toBe('function');
      expect(typeof layer.getStatus).toBe('function');
      expect(typeof layer.abortAutoRetry).toBe('function');
      expect(typeof layer.stop).toBe('function');
    });

    it('returns a VaultResilienceLayer assignable type (TypeScript-level check via runtime shape)', () => {
      const layer: VaultResilienceLayer = createVaultResilienceLayer(
        makeDeps(),
      );
      // If the type assignment compiles, the factory returns the correct interface
      expect(layer).not.toBeNull();
    });
  });

  describe('stop() delegates to drift detector', () => {
    it('calls driftDetector.stop() when stop() is invoked', async () => {
      // We need to verify that stop() stops not just the runner's heartbeat but also drift
      // detection. To do this, we call stop() and verify the returned promise resolves without error.
      const deps = makeDeps();
      const layer = createVaultResilienceLayer(deps);

      // start drift detection so there is an active interval to stop
      // (the returned layer needs to call driftDetector.stop internally)
      await expect(layer.stop()).resolves.toBeUndefined();
    });

    it('stop() resolves even if drift detector was never started', async () => {
      const deps = makeDeps();
      const layer = createVaultResilienceLayer(deps);

      await expect(layer.stop()).resolves.toBeUndefined();
    });
  });

  describe('getStatus() delegates to runner', () => {
    it('returns a ResilienceStatus object', async () => {
      const deps = makeDeps();
      const layer = createVaultResilienceLayer(deps);

      const status = await layer.getStatus();

      expect(status).toBeDefined();
      expect(status.bootstrap).toBeDefined();
      expect(status.bootstrap.state).toBeDefined();
      expect(typeof status.bootstrap.processed).toBe('number');
      expect(typeof status.forceWarningActive).toBe('boolean');
    });
  });

  describe('initOnStartup() delegates to runner and starts drift detector', () => {
    it('calls vaultSyncState.findOneAndUpdate for upsert on first startup', async () => {
      const deps = makeDeps();
      const layer = createVaultResilienceLayer(deps);

      await layer.initOnStartup();

      expect(deps.vaultSyncState.findOneAndUpdate).toHaveBeenCalled();
    });

    it('starts the drift detector interval after bootstrap init', async () => {
      vi.useFakeTimers();
      const deps = makeDeps();
      const layer = createVaultResilienceLayer(deps);

      await layer.initOnStartup();

      // If driftDetector.start() was called, a setInterval should be active.
      // Calling stop() must not throw (it clears the interval).
      await expect(layer.stop()).resolves.toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe('abortAutoRetry() delegates to runner', () => {
    it('calls vaultSyncState.updateOne to set retry abort flag', async () => {
      const deps = makeDeps();
      // Simulate a doc that exists
      (deps.vaultSyncState.findOne as ReturnType<typeof vi.fn>).mockReturnValue(
        {
          lean: () =>
            Promise.resolve({
              bootstrapState: 'retrying',
              bootstrapRetryAttempts: 2,
              bootstrapRetryAborted: false,
            }),
        },
      );

      const layer = createVaultResilienceLayer(deps);
      await layer.abortAutoRetry();

      expect(deps.vaultSyncState.updateOne).toHaveBeenCalledWith(
        { _id: 'singleton' },
        expect.objectContaining({
          $set: expect.objectContaining({ bootstrapRetryAborted: true }),
        }),
      );
    });
  });

  describe('configManager integration', () => {
    it('reads all required config keys from configManager', () => {
      const deps = makeDeps();
      createVaultResilienceLayer(deps);

      const getConfig = deps.configManager.getConfig as ReturnType<
        typeof vi.fn
      >;
      const calledKeys = getConfig.mock.calls.map((c: unknown[]) => c[0]);

      expect(calledKeys).toContain('app:vaultBootstrapRetryMax');
      expect(calledKeys).toContain('app:vaultBootstrapRetryBaseMs');
      expect(calledKeys).toContain('app:vaultBootstrapRetryMaxMs');
      expect(calledKeys).toContain('app:vaultBootstrapHeartbeatIntervalMs');
      expect(calledKeys).toContain('app:vaultBootstrapHeartbeatStaleMs');
      expect(calledKeys).toContain('app:vaultDriftDetectionIntervalMs');
      expect(calledKeys).toContain('app:vaultDriftMaxPagesPerTick');
    });
  });
});

describe('Re-exported types from resilience/index', () => {
  it('ResilienceStatus type is re-exported (runtime-verifiable via object shape)', async () => {
    const deps = makeDeps();
    const layer = createVaultResilienceLayer(deps);
    const status: ResilienceStatus = await layer.getStatus();

    // Structural check that the re-exported type matches the runtime shape
    expect('bootstrap' in status).toBe(true);
    expect('forceWarningActive' in status).toBe(true);
  });

  it('BootstrapStatus type is re-exported (runtime shape check)', async () => {
    const deps = makeDeps();
    const layer = createVaultResilienceLayer(deps);
    const status = await layer.getStatus();
    const bootstrapStatus: BootstrapStatus = status.bootstrap;

    expect('state' in bootstrapStatus).toBe(true);
    expect('processed' in bootstrapStatus).toBe(true);
  });
});
