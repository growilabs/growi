import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';

import { MERGE_MAX_TIME_MS } from './copy-current-revisions';
import { STALL_THRESHOLD_MS } from './duplicate-page-operation';
import {
  BOOT_RUN_DELAY_MS,
  RECOVERY_JITTER_MS,
} from './interrupted-duplicate-recovery-cron';

const MINUTE_MS = 60 * 1000;

/** The interval of a schedule of the form "*\/N * * * *". */
const intervalOfEveryNMinutes = (schedule: string): number => {
  const match = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
  if (match == null) {
    throw new Error(`Not an every-N-minutes schedule: "${schedule}"`);
  }
  return Number(match[1]) * MINUTE_MS;
};

// The time estimates these relations come from: design.md InterruptedDuplicateRecoveryCron.
describe('timing budget of the interrupted duplicate recovery', () => {
  it('starts recovering a duplicate within 15 minutes of its process stopping, on the default schedule (Req 4.2)', () => {
    const scheduleIntervalMs = intervalOfEveryNMinutes(
      CONFIG_DEFINITIONS['app:interruptedDuplicateRecoveryCronSchedule']
        .defaultValue,
    );

    expect(
      STALL_THRESHOLD_MS + scheduleIntervalMs + RECOVERY_JITTER_MS,
    ).toBeLessThanOrEqual(15 * MINUTE_MS);
  });

  it('starts the run after a restart within 5 minutes, but not before the duplicate of the process that died has expired (Req 4.3)', () => {
    expect(BOOT_RUN_DELAY_MS).toBeGreaterThanOrEqual(STALL_THRESHOLD_MS);
    expect(BOOT_RUN_DELAY_MS + RECOVERY_JITTER_MS).toBeLessThanOrEqual(
      5 * MINUTE_MS,
    );
  });

  it('stops a single revision copy before its duplicate could be judged stalled (Req 4.4)', () => {
    expect(MERGE_MAX_TIME_MS).toBeLessThan(STALL_THRESHOLD_MS);
  });
});
