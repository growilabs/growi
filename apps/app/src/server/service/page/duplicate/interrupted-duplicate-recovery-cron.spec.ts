// --- Mock boundary ---------------------------------------------------------
//
// Under test: whether the cron gets scheduled, and how one run reacts to a
// take-over that fails. Recovering real PageOperations is covered by
// interrupted-duplicate-recovery-cron.integ.ts against a real database.
//   - configManager            : mocked — drives the schedule
//   - node-cron                : mocked — asserts whether/what gets scheduled
//   - takeOverStalledDuplicate : mocked — a DB failure cannot be produced in
//                                the integration test
//   - recoverInterruptedDuplicate : mocked — never reached with a real record
//   - logger                   : mocked — a failed start-up run must end in a
//                                logged error, not an unhandled rejection
const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));

const { cronScheduleMock, scheduledTask } = vi.hoisted(() => ({
  cronScheduleMock: vi.fn(),
  scheduledTask: { start: vi.fn(), stop: vi.fn() },
}));
vi.mock('node-cron', () => ({
  default: { schedule: cronScheduleMock },
}));

const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
  }),
}));

vi.mock(import('./duplicate-page-operation'), async (importOriginal) => ({
  ...(await importOriginal()),
  takeOverStalledDuplicate: vi.fn(),
}));
vi.mock(import('./recover-interrupted-duplicate'), async (importOriginal) => ({
  ...(await importOriginal()),
  recoverInterruptedDuplicate: vi.fn(),
}));

import { PageGrant } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import {
  STALL_THRESHOLD_MS,
  type StalledDuplicatePageOperation,
  takeOverStalledDuplicate,
} from './duplicate-page-operation';
import type { DuplicateDeps } from './duplicate-page-port';
import {
  type InterruptedDuplicateRecoveryCronInput,
  InterruptedDuplicateRecoveryCronService,
  startInterruptedDuplicateRecoveryCronIfEnabled,
} from './interrupted-duplicate-recovery-cron';
import { recoverInterruptedDuplicate } from './recover-interrupted-duplicate';

const input = (): InterruptedDuplicateRecoveryCronInput => ({
  duplicateDeps: mock<DuplicateDeps>(),
  appService: { isMaintenanceMode: () => false },
  waitBeforeRun: async () => {},
});

const stalled = (operationId: string): StalledDuplicatePageOperation => ({
  operation: { operationId, ownerToken: 'token' },
  fromPath: '/from',
  toPath: `/to-${operationId}`,
  userId: '000000000000000000000001',
  sourceGrant: PageGrant.GRANT_PUBLIC,
  sourceDescendantCount: 0,
  sourceIsEmpty: false,
});

beforeEach(() => {
  // reset, not clear: a test may leave queued Once values unconsumed
  vi.resetAllMocks();
  cronScheduleMock.mockReturnValue(scheduledTask);
});

describe('startInterruptedDuplicateRecoveryCronIfEnabled', () => {
  // node-cron is mocked, so every take-over in these tests comes from the
  // start-up run.
  const startUpRunCount = (): number =>
    vi.mocked(takeOverStalledDuplicate).mock.calls.length;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(takeOverStalledDuplicate).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the recovery once, as soon as a PageOperation left by the previous process can have expired', async () => {
    getConfig.mockReturnValue('*/10 * * * *');

    startInterruptedDuplicateRecoveryCronIfEnabled(input());

    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS - 1);
    expect(startUpRunCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(startUpRunCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS * 10);
    expect(startUpRunCount()).toBe(1);
  });

  it('runs the start-up recovery after the injected delay', async () => {
    getConfig.mockReturnValue('*/10 * * * *');

    startInterruptedDuplicateRecoveryCronIfEnabled({
      ...input(),
      bootRunDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(startUpRunCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(startUpRunCount()).toBe(1);
  });

  it('logs a failed start-up run instead of leaving the rejection unhandled', async () => {
    getConfig.mockReturnValue('*/10 * * * *');
    const failure = new Error('maintenance check failed');

    startInterruptedDuplicateRecoveryCronIfEnabled({
      ...input(),
      waitBeforeRun: () => Promise.reject(failure),
      bootRunDelayMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(loggerError).toHaveBeenCalledWith(failure, expect.any(String));
  });

  it('does not let the pending start-up run keep the process alive', () => {
    vi.useRealTimers();
    getConfig.mockReturnValue('*/10 * * * *');
    // Only timers that keep the process alive are listed.
    const countAliveTimers = (): number =>
      process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = countAliveTimers();

    startInterruptedDuplicateRecoveryCronIfEnabled({
      ...input(),
      // the largest delay setTimeout accepts; the run never fires in this test
      bootRunDelayMs: 2_147_483_647,
    });

    expect(countAliveTimers()).toBe(before);
  });

  it('schedules the recovery with the configured expression', () => {
    getConfig.mockReturnValue('*/2 * * * *');

    startInterruptedDuplicateRecoveryCronIfEnabled(input());

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(cronScheduleMock.mock.calls[0][0]).toBe('*/2 * * * *');
    expect(scheduledTask.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty (the opt-out)', ''],
    ['blank', '   '],
    ['unset', undefined],
  ])('neither schedules nor runs the recovery when the schedule is %s', async (_, schedule) => {
    getConfig.mockReturnValue(schedule);

    startInterruptedDuplicateRecoveryCronIfEnabled({
      ...input(),
      bootRunDelayMs: 100,
    });
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS * 10);

    expect(cronScheduleMock).not.toHaveBeenCalled();
    expect(startUpRunCount()).toBe(0);
  });

  it('neither throws nor runs the recovery when the expression is invalid, so the boot survives', async () => {
    getConfig.mockReturnValue('not-a-cron-expression');
    cronScheduleMock.mockImplementation(() => {
      throw new Error('Invalid cron expression');
    });

    expect(() =>
      startInterruptedDuplicateRecoveryCronIfEnabled({
        ...input(),
        bootRunDelayMs: 100,
      }),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(STALL_THRESHOLD_MS * 10);

    expect(startUpRunCount()).toBe(0);
  });
});

describe('InterruptedDuplicateRecoveryCronService#executeJob', () => {
  it('ends the run when taking over fails', async () => {
    // e.g. the DB is unreachable: retrying within the run would never end
    vi.mocked(takeOverStalledDuplicate)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(stalled('op-2'))
      .mockResolvedValueOnce(null);
    const cron = new InterruptedDuplicateRecoveryCronService(input());

    await expect(cron.executeJob()).resolves.toBeUndefined();
    expect(takeOverStalledDuplicate).toHaveBeenCalledTimes(1);
    expect(recoverInterruptedDuplicate).not.toHaveBeenCalled();
  });

  it('goes on to the next PageOperation after a recovery fails', async () => {
    vi.mocked(takeOverStalledDuplicate)
      .mockResolvedValueOnce(stalled('op-1'))
      .mockResolvedValueOnce(stalled('op-2'))
      .mockResolvedValueOnce(null);
    vi.mocked(recoverInterruptedDuplicate)
      .mockRejectedValueOnce(new Error('notification failed'))
      .mockResolvedValueOnce({ status: 'recovered', copiedPageCount: 1 });
    const cron = new InterruptedDuplicateRecoveryCronService(input());

    await expect(cron.executeJob()).resolves.toBeUndefined();
    expect(
      vi
        .mocked(recoverInterruptedDuplicate)
        .mock.calls.map(([, target]) => target.operation.operationId),
    ).toEqual(['op-1', 'op-2']);
  });
});
