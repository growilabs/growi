import { readFile } from 'node:fs/promises';
import path from 'node:path';

import CronService from '~/server/service/cron';

import {
  createIntegrationPresence,
  PRESENCE_ANSWER_TTL_MS,
} from '../integration-presence';
import { sweepUnpairedRelations } from '../pairing/sweep-unpaired-relations';
import {
  ChatNotificationDispatchCronService,
  chatNotificationDispatchCronService,
} from './notification-dispatch-cron';

vi.mock('../pairing/sweep-unpaired-relations', () => ({
  sweepUnpairedRelations: vi.fn(),
}));

describe('ChatNotificationDispatchCronService', () => {
  it('is one of GROWI’s CronService jobs rather than a scheduling mechanism of its own', () => {
    expect(chatNotificationDispatchCronService).toBeInstanceOf(CronService);
  });

  it('runs every minute', () => {
    expect(chatNotificationDispatchCronService.getCronSchedule()).toBe(
      '* * * * *',
    );
  });

  describe('when deciding whether to drain', () => {
    const NOW = new Date('2026-01-01T00:00:00.000Z');
    const drainResult = { sent: 0, failed: 0, givenUp: 0 };

    it('does not drain when no integration exists', async () => {
      const drain = vi.fn().mockResolvedValue(drainResult);
      const hasAnyIntegration = vi.fn().mockResolvedValue(false);

      await new ChatNotificationDispatchCronService({
        dispatcher: { drain },
        presence: { hasAnyIntegration, markPresent: vi.fn() },
        clock: () => NOW,
      }).executeJob();

      expect(drain).not.toHaveBeenCalled();
    });

    it('drains once, at the clock’s instant, when an integration exists', async () => {
      const drain = vi.fn().mockResolvedValue(drainResult);
      const hasAnyIntegration = vi.fn().mockResolvedValue(true);

      await new ChatNotificationDispatchCronService({
        dispatcher: { drain },
        presence: { hasAnyIntegration, markPresent: vi.fn() },
        clock: () => NOW,
      }).executeJob();

      expect(hasAnyIntegration).toHaveBeenCalledWith(NOW);
      expect(drain).toHaveBeenCalledTimes(1);
      expect(drain).toHaveBeenCalledWith(NOW);
    });

    it('drains when the presence check fails open', async () => {
      const drain = vi.fn().mockResolvedValue(drainResult);
      const presence = createIntegrationPresence({
        anyRelationExists: vi.fn().mockRejectedValue(new Error('db down')),
      });

      await new ChatNotificationDispatchCronService({
        dispatcher: { drain },
        presence,
        clock: () => NOW,
      }).executeJob();

      expect(drain).toHaveBeenCalledTimes(1);
    });

    it('does not throw out of the job when draining fails', async () => {
      const drain = vi.fn().mockRejectedValue(new Error('proxy exploded'));

      await expect(
        new ChatNotificationDispatchCronService({
          dispatcher: { drain },
          presence: {
            hasAnyIntegration: vi.fn().mockResolvedValue(true),
            markPresent: vi.fn(),
          },
          clock: () => NOW,
        }).executeJob(),
      ).resolves.toBeUndefined();

      expect(drain).toHaveBeenCalledTimes(1);
    });
  });

  it('no longer sweeps relations: the dependency is not accepted and the sweep is never called', async () => {
    const drain = vi.fn().mockResolvedValue({ sent: 0, failed: 0, givenUp: 0 });

    await new ChatNotificationDispatchCronService({
      dispatcher: { drain },
      presence: {
        hasAnyIntegration: vi.fn().mockResolvedValue(true),
        markPresent: vi.fn(),
      },
      // @ts-expect-error the sweep now belongs to UnpairedRelationSweepCronService
      sweep: vi.fn(),
    }).executeJob();

    expect(sweepUnpairedRelations).not.toHaveBeenCalled();
  });

  // The 10-minute answer lifetime plus the 1-minute tick bound how long
  // another process takes to deliver a row whose writer stopped (2.9).
  describe('delivery of a row written by a process that then stopped', () => {
    const MINUTE = 60 * 1000;
    const T = new Date('2026-01-01T00:00:00.000Z').getTime();

    const firstDrainMinute = async (
      processBStartsDelayMs: number,
    ): Promise<number | null> => {
      let currentTime = T;
      // B decides "none" first; after the writer's row exists it says "some".
      const anyRelationExists = vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const drain = vi
        .fn()
        .mockResolvedValue({ sent: 0, failed: 0, givenUp: 0 });
      const cron = new ChatNotificationDispatchCronService({
        dispatcher: { drain },
        presence: createIntegrationPresence({ anyRelationExists }),
        clock: () => new Date(currentTime),
      });

      for (let minute = 0; minute <= 15; minute++) {
        currentTime =
          T + minute * MINUTE + (minute === 0 ? processBStartsDelayMs : 0);
        // biome-ignore lint/performance/noAwaitInLoops: ticks must run in order
        await cron.executeJob();
        if (drain.mock.calls.length > 0) {
          return minute;
        }
      }
      return null;
    };

    it('drains first on the tick where the remembered answer has expired', async () => {
      expect(PRESENCE_ANSWER_TTL_MS).toBe(10 * MINUTE);
      expect(await firstDrainMinute(0)).toBe(10);
    });

    it('drains one tick later when the deciding tick started late', async () => {
      expect(await firstDrainMinute(30 * 1000)).toBe(11);
    });
  });

  // The job only runs if something starts it, and design.md is explicit that
  // startup happens in one place for every cron in this repository ("4 つ目を
  // 新しく起こさず"). A renamed export or a dropped line here would leave the
  // whole notification pipeline silently idle, with every test above still
  // green -- so assert the wiring itself.
  it('is started from crowi’s single cron startup point', async () => {
    const crowiIndexPath = path.resolve(
      import.meta.dirname,
      '../../../../server/crowi/index.ts',
    );
    const source = await readFile(crowiIndexPath, 'utf8');

    expect(source).toContain('chatNotificationDispatchCronService');
    expect(source).toContain('chatNotificationDispatchCronService.startCron()');
  });
});
