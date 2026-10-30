import { readFile } from 'node:fs/promises';
import path from 'node:path';

import CronService from '~/server/service/cron';

import {
  ChatNotificationDispatchCronService,
  chatNotificationDispatchCronService,
} from './notification-dispatch-cron';

describe('ChatNotificationDispatchCronService', () => {
  it('is one of GROWI’s CronService jobs rather than a scheduling mechanism of its own', () => {
    expect(chatNotificationDispatchCronService).toBeInstanceOf(CronService);
  });

  it('runs every minute', () => {
    expect(chatNotificationDispatchCronService.getCronSchedule()).toBe(
      '* * * * *',
    );
  });

  it('drains the outbox and sweeps expired relations in the same run, at the same instant', async () => {
    const drain = vi.fn().mockResolvedValue({ sent: 0, failed: 0, givenUp: 0 });
    const sweep = vi.fn().mockResolvedValue({ relations: 0, accountLinks: 0 });

    await new ChatNotificationDispatchCronService({
      dispatcher: { drain },
      sweep,
    }).executeJob();

    expect(drain).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(drain.mock.calls[0][0]).toBeInstanceOf(Date);
    expect(sweep.mock.calls[0][0].getTime()).toBe(
      drain.mock.calls[0][0].getTime(),
    );
  });

  it('still sweeps when draining throws -- neither half may starve the other', async () => {
    const drain = vi.fn().mockRejectedValue(new Error('proxy exploded'));
    const sweep = vi.fn().mockResolvedValue({ relations: 0, accountLinks: 0 });

    await expect(
      new ChatNotificationDispatchCronService({
        dispatcher: { drain },
        sweep,
      }).executeJob(),
    ).resolves.toBeUndefined();

    expect(sweep).toHaveBeenCalledTimes(1);
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
