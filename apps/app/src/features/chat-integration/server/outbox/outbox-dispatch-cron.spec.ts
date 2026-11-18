import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type MockProxy, mock } from 'vitest-mock-extended';

import CronService from '~/server/service/cron';

import type { StaleAgentRequestSweep } from '../agent/sweep-stale-agent-requests';
import {
  createIntegrationPresence,
  PRESENCE_ANSWER_TTL_MS,
} from '../integration-presence';
import { sweepUnpairedRelations } from '../pairing/sweep-unpaired-relations';
import {
  OutboxDispatchCronService,
  outboxDispatchCronService,
} from './outbox-dispatch-cron';
import type { OutboxDispatcher } from './outbox-dispatcher';

vi.mock('../pairing/sweep-unpaired-relations', () => ({
  sweepUnpairedRelations: vi.fn(),
}));

const idleDispatcher = (): MockProxy<OutboxDispatcher> => {
  const dispatcher = mock<OutboxDispatcher>();
  dispatcher.requestDrain.mockResolvedValue(undefined);
  return dispatcher;
};

const idleSweep = () => vi.fn<StaleAgentRequestSweep>(async () => {});

const present = () => ({
  hasAnyIntegration: vi.fn(async () => true),
  markPresent: vi.fn(),
});

describe('OutboxDispatchCronService', () => {
  it('is one of GROWI’s CronService jobs rather than a scheduling mechanism of its own', () => {
    expect(outboxDispatchCronService).toBeInstanceOf(CronService);
  });

  it('runs every 5 minutes', () => {
    expect(outboxDispatchCronService.getCronSchedule()).toBe('*/5 * * * *');
  });

  describe('when deciding whether to drain', () => {
    const NOW = new Date('2026-01-01T00:00:00.000Z');

    it('does not drain when no integration exists', async () => {
      const dispatcher = idleDispatcher();
      const hasAnyIntegration = vi.fn().mockResolvedValue(false);

      await new OutboxDispatchCronService({
        sweep: idleSweep(),
        dispatcher,
        presence: { hasAnyIntegration, markPresent: vi.fn() },
        clock: () => NOW,
      }).executeJob();

      expect(dispatcher.requestDrain).not.toHaveBeenCalled();
      expect(dispatcher.drain).not.toHaveBeenCalled();
    });

    // Through `requestDrain`, so a tick that lands while a drain started by
    // a write is running never runs a second drain beside it.
    it('requests one drain, after asking at the clock’s instant, when an integration exists', async () => {
      const dispatcher = idleDispatcher();
      const hasAnyIntegration = vi.fn().mockResolvedValue(true);

      await new OutboxDispatchCronService({
        sweep: idleSweep(),
        dispatcher,
        presence: { hasAnyIntegration, markPresent: vi.fn() },
        clock: () => NOW,
      }).executeJob();

      expect(hasAnyIntegration).toHaveBeenCalledWith(NOW);
      expect(dispatcher.requestDrain).toHaveBeenCalledTimes(1);
      expect(dispatcher.drain).not.toHaveBeenCalled();
    });

    it('drains when the presence check fails open', async () => {
      const dispatcher = idleDispatcher();
      const presence = createIntegrationPresence({
        anyRelationExists: vi.fn().mockRejectedValue(new Error('db down')),
      });

      await new OutboxDispatchCronService({
        sweep: idleSweep(),
        dispatcher,
        presence,
        clock: () => NOW,
      }).executeJob();

      expect(dispatcher.requestDrain).toHaveBeenCalledTimes(1);
    });
  });

  // design.md 定期処理: after the presence check, the tick also sweeps agent
  // requests whose run stopped (Requirement 15.10).
  describe('when sweeping stale agent requests', () => {
    const NOW = new Date('2026-01-01T00:00:00.000Z');

    it('sweeps at the clock’s instant and requests a drain on each tick', async () => {
      const dispatcher = idleDispatcher();
      const sweep = idleSweep();

      await new OutboxDispatchCronService({
        sweep,
        dispatcher,
        presence: present(),
        clock: () => NOW,
      }).executeJob();

      expect(sweep).toHaveBeenCalledTimes(1);
      expect(sweep).toHaveBeenCalledWith(NOW);
      expect(dispatcher.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('does not sweep when no integration exists', async () => {
      const sweep = idleSweep();

      await new OutboxDispatchCronService({
        sweep,
        dispatcher: idleDispatcher(),
        presence: {
          hasAnyIntegration: vi.fn(async () => false),
          markPresent: vi.fn(),
        },
        clock: () => NOW,
      }).executeJob();

      expect(sweep).not.toHaveBeenCalled();
    });

    it.each([
      ['rejects', () => Promise.reject(new Error('db down'))],
      [
        'throws',
        () => {
          throw new Error('db down');
        },
      ],
    ])('still requests the drain when the sweep %s', async (_label, fails) => {
      const dispatcher = idleDispatcher();
      const sweep = vi.fn<StaleAgentRequestSweep>(fails);

      await expect(
        new OutboxDispatchCronService({
          sweep,
          dispatcher,
          presence: present(),
          clock: () => NOW,
        }).executeJob(),
      ).resolves.toBeUndefined();

      expect(dispatcher.requestDrain).toHaveBeenCalledTimes(1);
    });

    it('still sweeps when the drain cannot be requested', async () => {
      const dispatcher = mock<OutboxDispatcher>();
      dispatcher.requestDrain.mockRejectedValue(new Error('db down'));
      const sweep = idleSweep();

      await expect(
        new OutboxDispatchCronService({
          sweep,
          dispatcher,
          presence: present(),
          clock: () => NOW,
        }).executeJob(),
      ).resolves.toBeUndefined();

      expect(sweep).toHaveBeenCalledWith(NOW);
    });
  });

  it('never sweeps relations itself', async () => {
    await new OutboxDispatchCronService({
      sweep: idleSweep(),
      dispatcher: idleDispatcher(),
      presence: {
        hasAnyIntegration: vi.fn().mockResolvedValue(true),
        markPresent: vi.fn(),
      },
    }).executeJob();

    expect(sweepUnpairedRelations).not.toHaveBeenCalled();
  });

  // Requirement 2.9: the 10-minute answer lifetime plus the 5-minute tick
  // bound how long another process takes to deliver a row whose writer
  // stopped -- about 10 + 5 = 15 minutes.
  describe('delivery of a row written by a process that then stopped', () => {
    const MINUTE = 60 * 1000;
    const TICK_MINUTES = 5;
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
      const dispatcher = idleDispatcher();
      const cron = new OutboxDispatchCronService({
        sweep: idleSweep(),
        dispatcher,
        presence: createIntegrationPresence({ anyRelationExists }),
        clock: () => new Date(currentTime),
      });

      for (let minute = 0; minute <= 30; minute += TICK_MINUTES) {
        currentTime =
          T + minute * MINUTE + (minute === 0 ? processBStartsDelayMs : 0);
        // biome-ignore lint/performance/noAwaitInLoops: ticks must run in order
        await cron.executeJob();
        if (dispatcher.requestDrain.mock.calls.length > 0) {
          return minute;
        }
      }
      return null;
    };

    it('ticks every 5 minutes and remembers an answer for 10 minutes', () => {
      expect(outboxDispatchCronService.getCronSchedule()).toBe('*/5 * * * *');
      expect(PRESENCE_ANSWER_TTL_MS).toBe(10 * MINUTE);
    });

    it('drains first on the tick where the remembered answer has expired (10 minutes)', async () => {
      expect(await firstDrainMinute(0)).toBe(10);
    });

    it('drains one tick later when the deciding tick started late (10-minute answer + one 5-minute tick = 15 minutes)', async () => {
      expect(await firstDrainMinute(30 * 1000)).toBe(15);
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

    expect(source).toContain('outboxDispatchCronService');
    expect(source).toContain('outboxDispatchCronService.startCron()');
  });

  it('is the outbox module’s cron that crowi starts, and only once', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../../../../server/crowi/index.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /import \{[^}]*\boutboxDispatchCronService\b[^}]*\} from '~\/features\/chat-integration\/server\/outbox(\/outbox-dispatch-cron)?';/,
    );
    expect(
      source.match(/outboxDispatchCronService\.startCron\(\)/g),
    ).toHaveLength(1);
  });
});
