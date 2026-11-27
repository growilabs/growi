// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise the two route handlers directly. The operations they call
// (`countPasswordHashFormatDistribution`, `runPasswordHashCleanup`) own their own
// integration coverage against a real MongoDB, so they are mocked here and what is
// asserted is only what the handlers themselves add: the derived flags the UI gates
// on, the refusal status code, and the audit ordering.
//
// `mongoose` is mocked so the collection lookup does not need a live connection —
// the handlers only pass the returned object through to the mocked operations.
import type { Response } from 'express';
import { mockDeep } from 'vitest-mock-extended';

import type { IPasswordHashFormatDistribution } from '~/interfaces/password-hash-migration';
import type Crowi from '~/server/crowi';

const { countMock, cleanupMock, listMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  cleanupMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('mongoose', () => ({
  default: { connection: { collection: vi.fn(() => ({})) } },
}));
vi.mock('~/server/service/password-hash-format-distribution', () => ({
  countPasswordHashFormatDistribution: countMock,
}));
vi.mock('~/server/service/password-hash-cleanup', () => ({
  runPasswordHashCleanup: cleanupMock,
}));
vi.mock('~/server/service/password-hash-unmigrated-users', () => ({
  listPasswordHashUnmigratedUsers: listMock,
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  handleGetPasswordHashMigrationStatus,
  handleGetPasswordHashUnmigratedUsers,
  handlePasswordHashCleanup,
} from './password-hash';

const buildDistribution = (
  overrides: Partial<IPasswordHashFormatDistribution> = {},
): IPasswordHashFormatDistribution => ({
  upgradedOnly: 0,
  both: 0,
  legacyOnly: 0,
  legacyOnlyActive: 0,
  legacyOnlyNonActive: 0,
  noPassword: 0,
  ...overrides,
});

const buildRes = () => {
  const apiv3 = vi.fn();
  const apiv3Err = vi.fn();
  const res = {
    apiv3,
    apiv3Err,
    locals: { activity: { _id: 'activity-id' } },
  };
  // biome-ignore lint/suspicious/noExplicitAny: mocked express response
  return { res: res as any, apiv3, apiv3Err };
};

const buildCrowi = () => {
  const emit = vi.fn();
  const crowi = mockDeep<Crowi>({
    // biome-ignore lint/suspicious/noExplicitAny: only `activity.emit` is exercised
    events: { activity: { emit } } as any,
  });
  return { crowi, emit };
};

// biome-ignore lint/suspicious/noExplicitAny: mocked express request
const req = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleGetPasswordHashMigrationStatus', () => {
  it('reports the cleanup as blocked while any ACTIVE user is unmigrated', async () => {
    countMock.mockResolvedValue(
      buildDistribution({ both: 5, legacyOnly: 2, legacyOnlyActive: 2 }),
    );
    const { res, apiv3 } = buildRes();

    await handleGetPasswordHashMigrationStatus(req, res as Response as never);

    expect(apiv3).toHaveBeenCalledTimes(1);
    const body = apiv3.mock.calls[0][0];
    expect(body.isCleanupRunnable).toBe(false);
    expect(body.isCleanupCompleted).toBe(false);
    expect(body.distribution.both).toBe(5);
  });

  it('reports the cleanup as runnable once only non-ACTIVE users remain unmigrated', async () => {
    // A non-active unmigrated user must NOT block: nobody can compel them to log in.
    countMock.mockResolvedValue(
      buildDistribution({
        both: 3,
        legacyOnly: 4,
        legacyOnlyActive: 0,
        legacyOnlyNonActive: 4,
      }),
    );
    const { res, apiv3 } = buildRes();

    await handleGetPasswordHashMigrationStatus(req, res as Response as never);

    expect(apiv3.mock.calls[0][0].isCleanupRunnable).toBe(true);
    expect(apiv3.mock.calls[0][0].isCleanupCompleted).toBe(false);
  });

  it('reports completion when no legacy hash is left to remove', async () => {
    countMock.mockResolvedValue(
      buildDistribution({ upgradedOnly: 9, both: 0 }),
    );
    const { res, apiv3 } = buildRes();

    await handleGetPasswordHashMigrationStatus(req, res as Response as never);

    expect(apiv3.mock.calls[0][0].isCleanupCompleted).toBe(true);
  });

  it('does not report completion when nobody has migrated yet', async () => {
    // Regression: `both` is 0 here only because not a single user has migrated,
    // so every stored credential is still old-format. Deriving completion from
    // `both` alone reported that instance as already hardened.
    countMock.mockResolvedValue(
      buildDistribution({ both: 0, legacyOnly: 5, legacyOnlyActive: 5 }),
    );
    const { res, apiv3 } = buildRes();

    await handleGetPasswordHashMigrationStatus(req, res as Response as never);

    expect(apiv3.mock.calls[0][0].isCleanupCompleted).toBe(false);
    expect(apiv3.mock.calls[0][0].isCleanupRunnable).toBe(false);
  });

  it('does not report completion while only non-active users remain unmigrated', async () => {
    // There is nothing for the cleanup to remove, but old-format data is still
    // stored — the cleanup cannot touch it, because it is those users' only
    // credential. That is not the same as being finished.
    countMock.mockResolvedValue(
      buildDistribution({
        both: 0,
        legacyOnly: 2,
        legacyOnlyActive: 0,
        legacyOnlyNonActive: 2,
      }),
    );
    const { res, apiv3 } = buildRes();

    await handleGetPasswordHashMigrationStatus(req, res as Response as never);

    expect(apiv3.mock.calls[0][0].isCleanupCompleted).toBe(false);
    expect(apiv3.mock.calls[0][0].isCleanupRunnable).toBe(true);
  });

  it('answers with an error instead of throwing when the count fails', async () => {
    countMock.mockRejectedValue(new Error('db down'));
    const { res, apiv3, apiv3Err } = buildRes();

    await handleGetPasswordHashMigrationStatus(req, res as Response as never);

    expect(apiv3).not.toHaveBeenCalled();
    expect(apiv3Err).toHaveBeenCalledTimes(1);
  });
});

describe('handlePasswordHashCleanup', () => {
  it('refuses with 409 and records no activity when the operation aborts', async () => {
    // The server re-checks the blocking condition, so a client that ignores
    // `isCleanupRunnable` still cannot force the removal.
    cleanupMock.mockResolvedValue({
      aborted: true,
      legacyOnly: 7,
      legacyOnlyNonActive: 0,
      unset: 0,
    });
    const { crowi, emit } = buildCrowi();
    const { res, apiv3, apiv3Err } = buildRes();

    await handlePasswordHashCleanup(crowi)(req, res as Response as never);

    expect(apiv3).not.toHaveBeenCalled();
    expect(apiv3Err).toHaveBeenCalledTimes(1);
    expect(apiv3Err.mock.calls[0][1]).toBe(409);
    expect(apiv3Err.mock.calls[0][0].code).toBe(
      'password-hash-cleanup-blocked',
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('returns how many documents were cleaned on success', async () => {
    cleanupMock.mockResolvedValue({
      aborted: false,
      legacyOnly: 0,
      legacyOnlyNonActive: 0,
      unset: 12,
    });
    const { crowi } = buildCrowi();
    const { res, apiv3, apiv3Err } = buildRes();

    await handlePasswordHashCleanup(crowi)(req, res as Response as never);

    expect(apiv3Err).not.toHaveBeenCalled();
    expect(apiv3).toHaveBeenCalledWith({ unset: 12 });
  });

  it('records the audit activity BEFORE sending the response', async () => {
    // Regression guard for rules/activity-recording.md: the listener takes the
    // request context synchronously, and the response's `finish` clears it — so an
    // emit after res.apiv3() settles the row with a null operator.
    cleanupMock.mockResolvedValue({
      aborted: false,
      legacyOnly: 0,
      legacyOnlyNonActive: 0,
      unset: 1,
    });
    const { crowi, emit } = buildCrowi();
    const { res, apiv3 } = buildRes();

    await handlePasswordHashCleanup(crowi)(req, res as Response as never);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.invocationCallOrder[0]).toBeLessThan(
      apiv3.mock.invocationCallOrder[0],
    );
  });

  it('answers with an error instead of throwing when the operation fails', async () => {
    cleanupMock.mockRejectedValue(new Error('db down'));
    const { crowi, emit } = buildCrowi();
    const { res, apiv3, apiv3Err } = buildRes();

    await handlePasswordHashCleanup(crowi)(req, res as Response as never);

    expect(apiv3).not.toHaveBeenCalled();
    expect(apiv3Err).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('handleGetPasswordHashUnmigratedUsers', () => {
  const emptyPage = { users: [], totalCount: 0, page: 1, limit: 20 };

  // biome-ignore lint/suspicious/noExplicitAny: mocked express request
  const reqWithQuery = (query: Record<string, unknown>) => ({ query }) as any;

  it('defaults to the first page when no paging is asked for', async () => {
    listMock.mockResolvedValue(emptyPage);
    const { res, apiv3 } = buildRes();

    await handleGetPasswordHashUnmigratedUsers(
      reqWithQuery({}),
      res as Response as never,
    );

    expect(listMock.mock.calls[0][2]).toEqual({ page: 1, limit: 20 });
    expect(apiv3).toHaveBeenCalledWith(emptyPage);
  });

  it('passes a requested page through', async () => {
    listMock.mockResolvedValue(emptyPage);
    const { res } = buildRes();

    await handleGetPasswordHashUnmigratedUsers(
      reqWithQuery({ page: '3', limit: '50' }),
      res as Response as never,
    );

    expect(listMock.mock.calls[0][2]).toEqual({ page: 3, limit: 50 });
  });

  it('clamps an oversized limit instead of failing the request', async () => {
    // An out-of-range limit is a caller mistake worth absorbing — an administrator
    // should not get an error page because a query string was wrong.
    listMock.mockResolvedValue(emptyPage);
    const { res, apiv3Err } = buildRes();

    await handleGetPasswordHashUnmigratedUsers(
      reqWithQuery({ limit: '100000' }),
      res as Response as never,
    );

    expect(listMock.mock.calls[0][2].limit).toBe(100);
    expect(apiv3Err).not.toHaveBeenCalled();
  });

  it('falls back to the defaults for values that are not positive integers', async () => {
    listMock.mockResolvedValue(emptyPage);
    const { res } = buildRes();

    await handleGetPasswordHashUnmigratedUsers(
      reqWithQuery({ page: '0', limit: 'abc' }),
      res as Response as never,
    );

    expect(listMock.mock.calls[0][2]).toEqual({ page: 1, limit: 20 });
  });

  it('answers with an error instead of throwing when the listing fails', async () => {
    listMock.mockRejectedValue(new Error('db down'));
    const { res, apiv3, apiv3Err } = buildRes();

    await handleGetPasswordHashUnmigratedUsers(
      reqWithQuery({}),
      res as Response as never,
    );

    expect(apiv3).not.toHaveBeenCalled();
    expect(apiv3Err).toHaveBeenCalledTimes(1);
  });
});
