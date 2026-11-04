// --- Mock boundary ---------------------------------------------------------
//
// Only the scheduling contract is under test here — whether a cron gets
// registered, and with which expression. What the sweep does is covered by
// wip-page-cleanup-cron.integ.ts against a real database.
//   - configManager : mocked — drives the opt-out guard
//   - node-cron     : mocked — asserts whether/what gets scheduled
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

import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { startWipPageCleanupCronIfEnabled } from './wip-page-cleanup-cron';

const crowi = mock<Crowi>();

beforeEach(() => {
  vi.clearAllMocks();
  cronScheduleMock.mockReturnValue(scheduledTask);
});

describe('startWipPageCleanupCronIfEnabled', () => {
  it('schedules the sweep with the configured expression', () => {
    getConfig.mockReturnValue('0 4 * * *');

    startWipPageCleanupCronIfEnabled(crowi);

    expect(cronScheduleMock).toHaveBeenCalledTimes(1);
    expect(cronScheduleMock.mock.calls[0][0]).toBe('0 4 * * *');
    expect(scheduledTask.start).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing when the schedule is blank (the documented opt-out)', () => {
    // An operator disables the sweep by setting the env var to an empty string;
    // scheduling '' would instead throw inside node-cron.
    getConfig.mockReturnValue('   ');

    startWipPageCleanupCronIfEnabled(crowi);

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('schedules nothing when the schedule is unset', () => {
    getConfig.mockReturnValue(undefined);

    startWipPageCleanupCronIfEnabled(crowi);

    expect(cronScheduleMock).not.toHaveBeenCalled();
  });

  it('does not throw when the expression is invalid, so the boot survives', () => {
    getConfig.mockReturnValue('not-a-cron-expression');
    cronScheduleMock.mockImplementation(() => {
      throw new Error('Invalid cron expression');
    });

    expect(() => startWipPageCleanupCronIfEnabled(crowi)).not.toThrow();
  });
});
