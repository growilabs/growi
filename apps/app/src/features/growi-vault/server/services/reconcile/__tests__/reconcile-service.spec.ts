/**
 * reconcile-service.spec.ts
 *
 * Unit tests for VaultReconcileService.submit() acceptance gate.
 *
 * All dependencies are mocked. Tests verify:
 * - Acceptance gate ordering (invalid-target → bootstrap-not-done → page not found
 *   → page-count-limit → concurrency-limit → accepted)
 * - No countDocuments call during acceptance gate
 * - Correct response shapes for accepted and rejected results
 * - Audit events emitted on rejection
 *
 * Requirements: 1.1, 1.2, 1.3, 2.6, 4.2, 4.3, 4.4, 5.4, 6.1, 6.2, 6.3, 6.4,
 *               6.5, 6.8, 6.9
 */

import { describe, expect, it, vi } from 'vitest';

import type { ReconcileLogEntry } from '../reconcile-history-store';
import type {
  ReconcileRequest,
  VaultReconcileServiceDeps,
} from '../reconcile-service';
import { createVaultReconcileService } from '../reconcile-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Typed accessor for the mock findOne on pageModel. */
function pageModelFindOne(deps: VaultReconcileServiceDeps) {
  return deps.pageModel.findOne as ReturnType<typeof vi.fn>;
}

/** Typed accessor for the mock resolveTarget on targetResolver. */
function resolveTargetMock(deps: VaultReconcileServiceDeps) {
  return deps.targetResolver.resolveTarget as ReturnType<typeof vi.fn>;
}

/** Typed accessor for the mock getStatus on resilienceLayer. */
function getStatusMock(deps: VaultReconcileServiceDeps) {
  return deps.resilienceLayer.getStatus as ReturnType<typeof vi.fn>;
}

/** Typed accessor for the mock getConfig on configManager. */
function getConfigMock(deps: VaultReconcileServiceDeps) {
  return deps.configManager.getConfig as ReturnType<typeof vi.fn>;
}

/** Typed accessor for the mock tryRunInBackground on concurrencyController. */
function tryRunInBackgroundMock(deps: VaultReconcileServiceDeps) {
  return deps.concurrencyController.tryRunInBackground as ReturnType<
    typeof vi.fn
  >;
}

/** Typed accessor for countDocuments spy (added to pageModel mock for assertion). */
function countDocumentsSpy(deps: VaultReconcileServiceDeps) {
  return (
    deps.pageModel as unknown as { countDocuments: ReturnType<typeof vi.fn> }
  ).countDocuments;
}

/**
 * Creates a full mock of VaultReconcileServiceDeps with sensible defaults.
 * Individual tests override only what they need.
 */
function makeDeps(
  overrides: Partial<VaultReconcileServiceDeps> = {},
): VaultReconcileServiceDeps {
  const targetResolverMock = {
    resolveTarget: vi
      .fn()
      .mockReturnValue({ ok: true, query: { path: '/test' } }),
  };

  const resilienceLayerMock = {
    getStatus: vi.fn().mockResolvedValue({
      bootstrap: { state: 'done' },
    }),
  };

  const pageModelMock = {
    findOne: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'page-id',
        path: '/test',
        descendantCount: 5,
        grant: 1,
        grantedUsers: [],
        grantedGroups: [],
      }),
    }),
    // countDocuments is intentionally a spy — tests assert it is never called
    countDocuments: vi.fn().mockResolvedValue(0),
  };

  const aclEvaluatorMock = {
    buildEligibleQuery: vi.fn().mockResolvedValue({
      eligibleQuery: { path: '/test' },
    }),
  };

  const historyStoreMock = {
    create: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    listRecent: vi.fn().mockResolvedValue([]),
    normalizeStaleLifecycle: vi.fn().mockResolvedValue(0),
  };

  const concurrencyControllerMock = {
    tryRunInBackground: vi.fn().mockReturnValue({ ok: true }),
    getActiveCount: vi.fn().mockReturnValue(0),
    reset: vi.fn(),
  };

  const orchestratorMock = {
    run: vi.fn().mockResolvedValue(undefined),
  };

  const configManagerMock = {
    getConfig: vi.fn((key: string) => {
      switch (key) {
        case 'app:vaultReconcileMaxPagesPerUserRequest':
          return 1000;
        case 'app:vaultReconcileMaxPagesPerAdminRequest':
          return 1000;
        case 'app:vaultReconcileRejectWhenBootstrapNotDone':
          return true;
        default:
          return undefined;
      }
    }),
  };

  const createActivityMock = vi.fn().mockResolvedValue(undefined);

  return {
    pageModel:
      pageModelMock as unknown as VaultReconcileServiceDeps['pageModel'],
    targetResolver:
      targetResolverMock as VaultReconcileServiceDeps['targetResolver'],
    aclEvaluator: aclEvaluatorMock as VaultReconcileServiceDeps['aclEvaluator'],
    concurrencyController:
      concurrencyControllerMock as VaultReconcileServiceDeps['concurrencyController'],
    historyStore: historyStoreMock as VaultReconcileServiceDeps['historyStore'],
    orchestrator: orchestratorMock as VaultReconcileServiceDeps['orchestrator'],
    resilienceLayer:
      resilienceLayerMock as VaultReconcileServiceDeps['resilienceLayer'],
    configManager:
      configManagerMock as unknown as VaultReconcileServiceDeps['configManager'],
    createActivity: createActivityMock,
    ...overrides,
  };
}

const defaultRequest: ReconcileRequest = {
  targetType: 'sub-tree',
  targetPath: '/test',
  triggeredBy: { userId: 'user-1', isAdmin: false },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultReconcileService.submit', () => {
  describe('Step 1: TargetResolver returns ok:false → invalid-target', () => {
    it('returns rejected with invalid-target when targetResolver returns ok:false', async () => {
      const deps = makeDeps();
      resolveTargetMock(deps).mockReturnValue({
        ok: false,
        reason: 'invalid-target',
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result).toEqual({ status: 'rejected', reason: 'invalid-target' });
    });

    it('does not call pageModel.findOne when target is invalid', async () => {
      const deps = makeDeps();
      resolveTargetMock(deps).mockReturnValue({
        ok: false,
        reason: 'invalid-target',
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(pageModelFindOne(deps)).not.toHaveBeenCalled();
    });

    it('does not insert a history record when target is invalid', async () => {
      const deps = makeDeps();
      resolveTargetMock(deps).mockReturnValue({
        ok: false,
        reason: 'invalid-target',
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(deps.historyStore.create).not.toHaveBeenCalled();
    });
  });

  describe('Step 2: Bootstrap not done → bootstrap-not-done', () => {
    it('returns rejected with bootstrap-not-done when state is not done and rejectWhenBootstrapNotDone=true', async () => {
      const deps = makeDeps();
      getStatusMock(deps).mockResolvedValue({
        bootstrap: { state: 'running' },
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result).toEqual({
        status: 'rejected',
        reason: 'bootstrap-not-done',
      });
    });

    it('does NOT reject when bootstrapState is done', async () => {
      const deps = makeDeps();
      getStatusMock(deps).mockResolvedValue({ bootstrap: { state: 'done' } });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result.status).toBe('accepted');
    });

    it('does NOT reject bootstrap-not-done when rejectWhenBootstrapNotDone=false', async () => {
      const deps = makeDeps();
      getStatusMock(deps).mockResolvedValue({
        bootstrap: { state: 'running' },
      });
      getConfigMock(deps).mockImplementation((key: string) => {
        if (key === 'app:vaultReconcileRejectWhenBootstrapNotDone')
          return false;
        if (key === 'app:vaultReconcileMaxPagesPerUserRequest') return 1000;
        if (key === 'app:vaultReconcileMaxPagesPerAdminRequest') return 1000;
        return undefined;
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      // Should proceed past bootstrap check and eventually accept
      expect(result.status).toBe('accepted');
    });
  });

  describe('Step 3: Target page not found → invalid-target', () => {
    it('returns rejected with invalid-target when findOne returns null', async () => {
      const deps = makeDeps();
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result).toEqual({ status: 'rejected', reason: 'invalid-target' });
    });

    it('queries findOne with the required projection fields', async () => {
      const deps = makeDeps();

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(pageModelFindOne(deps)).toHaveBeenCalledWith(
        { path: '/test' },
        expect.objectContaining({ descendantCount: 1 }),
      );
    });
  });

  describe('Step 4: Page count limit check', () => {
    it('rejects with page-count-exceeds-user-limit for non-admin when plannedPageCount > userLimit', async () => {
      const deps = makeDeps();
      // descendantCount=1000 → plannedPageCount=1001 which exceeds limit=1000
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'page-id',
          path: '/test',
          descendantCount: 1000,
        }),
      });
      getConfigMock(deps).mockImplementation((key: string) => {
        if (key === 'app:vaultReconcileMaxPagesPerUserRequest') return 1000;
        if (key === 'app:vaultReconcileMaxPagesPerAdminRequest') return 1000;
        if (key === 'app:vaultReconcileRejectWhenBootstrapNotDone') return true;
        return undefined;
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit({
        ...defaultRequest,
        targetType: 'sub-tree',
        triggeredBy: { userId: 'user-1', isAdmin: false },
      });

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'page-count-exceeds-user-limit',
        descendantCount: 1000,
        roleLimit: 1000,
      });
    });

    it('rejects with page-count-exceeds-admin-limit for admin when plannedPageCount > adminLimit', async () => {
      const deps = makeDeps();
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'page-id',
          path: '/test',
          descendantCount: 2000,
        }),
      });
      getConfigMock(deps).mockImplementation((key: string) => {
        if (key === 'app:vaultReconcileMaxPagesPerUserRequest') return 1000;
        if (key === 'app:vaultReconcileMaxPagesPerAdminRequest') return 2000;
        if (key === 'app:vaultReconcileRejectWhenBootstrapNotDone') return true;
        return undefined;
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit({
        ...defaultRequest,
        targetType: 'sub-tree',
        triggeredBy: { userId: 'admin-1', isAdmin: true },
      });

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'page-count-exceeds-admin-limit',
        descendantCount: 2000,
        roleLimit: 2000,
      });
    });

    it('does NOT reject for targetType=page when descendantCount is large (planned=1)', async () => {
      const deps = makeDeps();
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'page-id',
          path: '/test',
          descendantCount: 99999, // large but targetType=page → plannedPageCount=1
        }),
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit({
        ...defaultRequest,
        targetType: 'page',
      });

      // plannedPageCount=1 ≤ userLimit=1000 → accept
      expect(result.status).toBe('accepted');
    });

    it('emits vault.reconcile.rejected audit when page count exceeds limit', async () => {
      const deps = makeDeps();
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'page-id',
          path: '/test',
          descendantCount: 1000,
        }),
      });

      const service = createVaultReconcileService(deps);
      await service.submit({
        ...defaultRequest,
        targetType: 'sub-tree',
        triggeredBy: { userId: 'user-1', isAdmin: false },
      });

      expect(deps.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vault.reconcile.rejected' }),
      );
    });

    it('inserts a rejected history record when page count exceeds limit', async () => {
      const deps = makeDeps();
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'page-id',
          path: '/test',
          descendantCount: 1000,
        }),
      });

      const service = createVaultReconcileService(deps);
      await service.submit({
        ...defaultRequest,
        targetType: 'sub-tree',
        triggeredBy: { userId: 'user-1', isAdmin: false },
      });

      expect(deps.historyStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          rejectReason: 'page-count-exceeds-user-limit',
        }),
      );
    });
  });

  describe('Step 6+7: ConcurrencyController rejects → concurrency limit', () => {
    it('returns rejected with user-concurrency-limit when controller returns ok:false', async () => {
      const deps = makeDeps();
      tryRunInBackgroundMock(deps).mockReturnValue({
        ok: false,
        reason: 'user-concurrency-limit',
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result).toEqual({
        status: 'rejected',
        reason: 'user-concurrency-limit',
      });
    });

    it('returns rejected with system-concurrency-limit when controller returns ok:false', async () => {
      const deps = makeDeps();
      tryRunInBackgroundMock(deps).mockReturnValue({
        ok: false,
        reason: 'system-concurrency-limit',
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result).toEqual({
        status: 'rejected',
        reason: 'system-concurrency-limit',
      });
    });

    it('updates history record to rejected when concurrency limit is hit', async () => {
      const deps = makeDeps();
      tryRunInBackgroundMock(deps).mockReturnValue({
        ok: false,
        reason: 'system-concurrency-limit',
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      // create is called first with pending, then updateStatus with rejected
      expect(deps.historyStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' }),
      );
      expect(deps.historyStore.updateStatus).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          status: 'rejected',
          rejectReason: 'system-concurrency-limit',
        }),
      );
    });

    it('emits vault.reconcile.rejected audit when concurrency limit is hit', async () => {
      const deps = makeDeps();
      tryRunInBackgroundMock(deps).mockReturnValue({
        ok: false,
        reason: 'user-concurrency-limit',
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(deps.createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'vault.reconcile.rejected' }),
      );
    });
  });

  describe('Happy path: accepted', () => {
    it('returns accepted shape { status, reconcileId, descendantCount }', async () => {
      const deps = makeDeps();

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result.status).toBe('accepted');
      if (result.status === 'accepted') {
        expect(typeof result.reconcileId).toBe('string');
        expect(result.reconcileId.length).toBeGreaterThan(0);
        expect(result.descendantCount).toBe(5);
      }
    });

    it('accepted result does NOT have noop or eligiblePageCount fields', async () => {
      const deps = makeDeps();

      const service = createVaultReconcileService(deps);
      const result = await service.submit(defaultRequest);

      expect(result.status).toBe('accepted');
      expect(result).not.toHaveProperty('noop');
      expect(result).not.toHaveProperty('eligiblePageCount');
    });

    it('inserts a pending history record when accepted', async () => {
      const deps = makeDeps();

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(deps.historyStore.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', descendantCount: 5 }),
      );
    });

    it('calls tryRunInBackground with correct userId and isAdmin', async () => {
      const deps = makeDeps();

      const service = createVaultReconcileService(deps);
      await service.submit({
        ...defaultRequest,
        triggeredBy: { userId: 'user-42', isAdmin: true },
      });

      expect(
        deps.concurrencyController.tryRunInBackground,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-42', isAdmin: true }),
      );
    });

    it('calls aclEvaluator.buildEligibleQuery before calling tryRunInBackground', async () => {
      const deps = makeDeps();
      const callOrder: string[] = [];

      (
        deps.aclEvaluator.buildEligibleQuery as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        callOrder.push('aclEvaluator');
        return Promise.resolve({ eligibleQuery: { path: '/test' } });
      });
      tryRunInBackgroundMock(deps).mockImplementation(() => {
        callOrder.push('tryRunInBackground');
        return { ok: true };
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(callOrder.indexOf('aclEvaluator')).toBeLessThan(
        callOrder.indexOf('tryRunInBackground'),
      );
    });
  });

  describe('Constraint: countDocuments is NEVER called during accept gate', () => {
    it('never calls pageModel.countDocuments during submit', async () => {
      const deps = makeDeps();

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(countDocumentsSpy(deps)).not.toHaveBeenCalled();
    });

    it('never calls pageModel.countDocuments even when target is invalid', async () => {
      const deps = makeDeps();
      resolveTargetMock(deps).mockReturnValue({
        ok: false,
        reason: 'invalid-target',
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(countDocumentsSpy(deps)).not.toHaveBeenCalled();
    });

    it('never calls pageModel.countDocuments when concurrency limit is hit', async () => {
      const deps = makeDeps();
      tryRunInBackgroundMock(deps).mockReturnValue({
        ok: false,
        reason: 'system-concurrency-limit',
      });

      const service = createVaultReconcileService(deps);
      await service.submit(defaultRequest);

      expect(countDocumentsSpy(deps)).not.toHaveBeenCalled();
    });
  });

  describe('422 reject body shape for page-count-exceeds-*-limit', () => {
    it('includes reason, descendantCount, and roleLimit in the reject body', async () => {
      const deps = makeDeps();
      pageModelFindOne(deps).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'page-id',
          path: '/test',
          descendantCount: 500,
        }),
      });
      getConfigMock(deps).mockImplementation((key: string) => {
        if (key === 'app:vaultReconcileMaxPagesPerUserRequest') return 100;
        if (key === 'app:vaultReconcileMaxPagesPerAdminRequest') return 500;
        if (key === 'app:vaultReconcileRejectWhenBootstrapNotDone') return true;
        return undefined;
      });

      const service = createVaultReconcileService(deps);
      const result = await service.submit({
        ...defaultRequest,
        targetType: 'sub-tree',
        triggeredBy: { userId: 'user-1', isAdmin: false },
      });

      expect(result).toEqual({
        status: 'rejected',
        reason: 'page-count-exceeds-user-limit',
        descendantCount: 500,
        roleLimit: 100,
      });
    });
  });
});

describe('VaultReconcileService.listHistory', () => {
  it('delegates to historyStore.listRecent', async () => {
    const mockEntries: readonly ReconcileLogEntry[] = [];
    const deps = makeDeps();
    (
      deps.historyStore.listRecent as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockEntries);

    const service = createVaultReconcileService(deps);
    const result = await service.listHistory({ limit: 10, offset: 0 });

    expect(deps.historyStore.listRecent).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
    });
    expect(result).toBe(mockEntries);
  });

  it('uses default limit when not provided', async () => {
    const deps = makeDeps();
    (
      deps.historyStore.listRecent as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const service = createVaultReconcileService(deps);
    await service.listHistory({});

    expect(deps.historyStore.listRecent).toHaveBeenCalled();
  });
});

describe('VaultReconcileService.stop', () => {
  it('resolves without error', async () => {
    const deps = makeDeps();
    const service = createVaultReconcileService(deps);
    await expect(service.stop()).resolves.toBeUndefined();
  });
});
