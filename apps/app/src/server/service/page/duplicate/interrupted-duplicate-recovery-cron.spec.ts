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
  it('schedules the recovery with the configured expression', () => {
    getConfig.mockReturnValue('*/2 * * * *');

    startInterruptedDuplicateRecoveryCronIfEnabled(input());

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(cronScheduleMock.mock.calls[0][0]).toBe('*/2 * * * *');
    expect(scheduledTask.start).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing when the schedule is blank (the opt-out)', () => {
    getConfig.mockReturnValue('   ');

    startInterruptedDuplicateRecoveryCronIfEnabled(input());

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('schedules nothing when the schedule is unset', () => {
    getConfig.mockReturnValue(undefined);

    startInterruptedDuplicateRecoveryCronIfEnabled(input());

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('does not throw when the expression is invalid, so the boot survives', () => {
    getConfig.mockReturnValue('not-a-cron-expression');
    cronScheduleMock.mockImplementation(() => {
      throw new Error('Invalid cron expression');
    });

    expect(() =>
      startInterruptedDuplicateRecoveryCronIfEnabled(input()),
    ).not.toThrow();
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
