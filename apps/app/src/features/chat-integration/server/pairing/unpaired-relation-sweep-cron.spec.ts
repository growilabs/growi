import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mock } from 'vitest-mock-extended';

import CronService from '~/server/service/cron';

import type { IntegrationPresence } from '../integration-presence';
import {
  SWEEP_MAX_JITTER_MS,
  UnpairedRelationSweepCronService,
  unpairedRelationSweepCronService,
} from './unpaired-relation-sweep-cron';

const NOW = new Date('2030-01-01T02:30:00.000Z');
const SUMMARY = { relations: 0, accountLinks: 0 };

describe('UnpairedRelationSweepCronService', () => {
  it('is one of GROWI’s CronService jobs running once a day', () => {
    expect(unpairedRelationSweepCronService).toBeInstanceOf(CronService);
    expect(unpairedRelationSweepCronService.getCronSchedule()).toBe(
      '0 2 * * *',
    );
  });

  it('waits up to 60 minutes first, decides only after the wait, and sweeps at the clock instant when an integration exists', async () => {
    const events: string[] = [];
    let finishWait: () => void = () => {};
    const sleep = vi.fn(
      (_maxMs: number) =>
        new Promise<void>((resolve) => {
          events.push('sleep');
          finishWait = resolve;
        }),
    );
    const presence = mock<IntegrationPresence>({
      hasAnyIntegration: vi.fn(() => {
        events.push('presence');
        return Promise.resolve(true);
      }),
    });
    const clock = vi.fn(() => {
      events.push('clock');
      return NOW;
    });
    const sweep = vi.fn(() => {
      events.push('sweep');
      return Promise.resolve(SUMMARY);
    });

    const job = new UnpairedRelationSweepCronService({
      sweep,
      presence,
      clock,
      sleep,
    }).executeJob();
    await new Promise((resolve) => setImmediate(resolve));

    expect(sleep).toHaveBeenCalledWith(60 * 60 * 1000);
    expect(clock).not.toHaveBeenCalled();
    expect(presence.hasAnyIntegration).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();

    finishWait();
    await job;

    expect(SWEEP_MAX_JITTER_MS).toBe(60 * 60 * 1000);
    expect(presence.hasAnyIntegration).toHaveBeenCalledWith(NOW);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledWith(NOW);
    expect(events).toEqual(['sleep', 'clock', 'presence', 'sweep']);
  });

  it('does not sweep when no integration exists', async () => {
    const presence = mock<IntegrationPresence>({
      hasAnyIntegration: vi.fn(() => Promise.resolve(false)),
    });
    const sweep = vi.fn(() => Promise.resolve(SUMMARY));

    await new UnpairedRelationSweepCronService({
      sweep,
      presence,
      clock: () => NOW,
      sleep: async () => {},
    }).executeJob();

    expect(sweep).not.toHaveBeenCalled();
  });

  it('does not fail the job when the sweep throws', async () => {
    const presence = mock<IntegrationPresence>({
      hasAnyIntegration: vi.fn(() => Promise.resolve(true)),
    });
    const sweep = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(
      new UnpairedRelationSweepCronService({
        sweep,
        presence,
        clock: () => NOW,
        sleep: async () => {},
      }).executeJob(),
    ).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  // A dropped startCron() line would leave the sweep running nowhere while
  // every other test stays green.
  it('is started from crowi’s startup point, right after the notification cron', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../../../server/crowi/index.ts'),
      'utf8',
    );

    const dispatch = source.indexOf(
      'chatNotificationDispatchCronService.startCron()',
    );
    const sweepStart = source.indexOf(
      'unpairedRelationSweepCronService.startCron()',
    );
    expect(dispatch).toBeGreaterThan(-1);
    expect(sweepStart).toBeGreaterThan(dispatch);
  });
});
