import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the SUT import.
// ---------------------------------------------------------------------------

vi.mock('./services/vault-settings-service', () => ({
  vaultSettingsService: {
    getSettings: vi.fn(),
  },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Shared logger spies so tests can assert on warn calls. Declared via
// vi.hoisted so the references survive vi.mock's hoisting transform.
const { loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
  }),
}));

const dispatcherOnPageChanged = vi.fn().mockResolvedValue(undefined);
const dispatcherOnBulkOperation = vi.fn().mockResolvedValue(undefined);

vi.mock('./services/vault-dispatcher', () => ({
  createVaultDispatcher: vi.fn(() => ({
    onPageChanged: dispatcherOnPageChanged,
    onBulkOperation: dispatcherOnBulkOperation,
  })),
}));

vi.mock('./services/vault-bootstrapper', () => ({
  createVaultBootstrapper: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(),
  })),
}));

// Other named exports used by the SUT but not relevant to subscription tests.
vi.mock('./services/vault-namespace-mapper', () => ({
  vaultNamespaceMapper: {
    computeAccessibleNamespaces: vi.fn(),
    computePageNamespaces: vi.fn(),
  },
}));

vi.mock('./routes/vault-gateway', () => ({
  createVaultGatewayRouter: vi.fn(),
}));

vi.mock('./routes/vault-admin', () => ({
  createVaultAdminRouter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the SUT after the mocks are in place.
// ---------------------------------------------------------------------------

import { configManager } from '~/server/service/config-manager';

import { initializeVaultFeature } from './index';
import { vaultSettingsService } from './services/vault-settings-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrowiStub() {
  return {
    events: {
      page: new EventEmitter(),
    },
  };
}

function enableVaultSettings() {
  (
    vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    enabled: true,
    managerEndpoint: 'http://vault-manager',
    managerInternalSecret: 'secret',
  });
  (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(false);
}

/** Flush microtasks so that fire-and-forget promises chain resolve. */
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initializeVaultFeature — updateMany subscription (task 21.1-A / Stage 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableVaultSettings();
  });

  it('dispatches one per-page upsert for every page carried by updateMany', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
      { _id: { toString: () => 'p2' }, path: '/a/y', revision: 'r2' },
      { _id: { toString: () => 'p3' }, path: '/a/z', revision: 'r3' },
    ];

    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(3);
    expect(dispatcherOnPageChanged).toHaveBeenNthCalledWith(1, {
      type: 'update',
      page: pages[0],
      revisionId: 'r1',
    });
    expect(dispatcherOnPageChanged).toHaveBeenNthCalledWith(3, {
      type: 'update',
      page: pages[2],
      revisionId: 'r3',
    });
  });

  it('skips pages with no revision (auto-generated intermediate paths)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
      // Auto-generated intermediate page — no revision.
      { _id: { toString: () => 'p2' }, path: '/a' },
      { _id: { toString: () => 'p3' }, path: '/a/z', revision: 'r3' },
    ];

    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(2);
    const dispatched = dispatcherOnPageChanged.mock.calls.map(
      (args) => (args[0] as { revisionId: string }).revisionId,
    );
    expect(dispatched).toEqual(['r1', 'r3']);
  });

  it('resolves revision when populated as an ObjectId-like object', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const populatedRevision = {
      _id: { toString: () => 'rev-from-populated' },
    };
    const pages = [
      {
        _id: { toString: () => 'p1' },
        path: '/a/x',
        revision: populatedRevision,
      },
    ];

    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(1);
    expect(dispatcherOnPageChanged).toHaveBeenCalledWith({
      type: 'update',
      page: pages[0],
      revisionId: 'rev-from-populated',
    });
  });

  it('does nothing when the payload is not an array (defensive)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    crowi.events.page.emit('updateMany', undefined, { _id: 'u1' });
    crowi.events.page.emit('updateMany', null, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
  });

  it('does not subscribe to updateMany when vaultEnabled=false', async () => {
    (
      vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      enabled: false,
      managerEndpoint: '',
      managerInternalSecret: '',
    });

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
    ];
    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
  });

  it('logs a warning and does not throw when dispatcher.onPageChanged rejects', async () => {
    dispatcherOnPageChanged.mockRejectedValueOnce(new Error('boom'));

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
    ];

    // The emit must not propagate the rejection — fire-and-forget catch is
    // expected to swallow it into a logger.warn call.
    expect(() =>
      crowi.events.page.emit('updateMany', pages, { _id: 'u1' }),
    ).not.toThrow();
    await flush();

    expect(loggerWarn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'vault-dispatcher: error handling updateMany entry',
    );
  });
});
