import { mock } from 'vitest-mock-extended';

import { SocketEventName } from '~/interfaces/websocket';
import type { SocketIoService } from '~/server/service/socket-io';

import type { BacklinksBackfillProgressData } from '../../interfaces/page-link-backfill';
import {
  createAdminProgressEmitter,
  PageLinkBackfillCron,
} from './page-link-backfill-cron';

// The job store is the boundary the race is about: holding its replies open fixes the order in
// which a tick and an admin request interleave, which real database calls cannot.
const jobs = vi.hoisted(() => ({
  tryClaim: vi.fn<() => Promise<boolean>>(),
  isRunOutstanding: vi.fn<() => Promise<boolean>>(),
}));
vi.mock('~/utils/prisma', () => ({ prisma: { pagelinkbackfilljobs: jobs } }));

const PROGRESS: BacklinksBackfillProgressData = {
  status: 'running',
  processed: 3,
  runTotal: 10,
  skippedPages: 0,
};

describe('createAdminProgressEmitter', () => {
  it('sends the progress on the admin channel', () => {
    const adminSocket = mock<ReturnType<SocketIoService['getAdminSocket']>>();
    const socketIoService = mock<SocketIoService>();
    socketIoService.getAdminSocket.mockReturnValue(adminSocket);

    createAdminProgressEmitter(socketIoService)(PROGRESS);

    expect(adminSocket.emit).toHaveBeenCalledWith(
      SocketEventName.BacklinksBackfillProgress,
      PROGRESS,
    );
  });

  // The backfill runs off the request path; a missing progress line must not fail the run.
  it('drops the progress instead of throwing before the HTTP server is attached', () => {
    const socketIoService = mock<SocketIoService>();
    socketIoService.getAdminSocket.mockImplementation(() => {
      throw new Error('Http server has not attached yet.');
    });

    expect(() =>
      createAdminProgressEmitter(socketIoService)(PROGRESS),
    ).not.toThrow();
  });
});

describe('PageLinkBackfillCron, when an admin request arrives during a tick that found nothing', () => {
  let cron: PageLinkBackfillCron;

  beforeEach(() => {
    vi.clearAllMocks();
    cron = new PageLinkBackfillCron({
      // Armed but never due here: every tick below is driven by hand.
      cronSchedule: '0 0 1 1 *',
      pacing: { dutyCyclePercent: 25, maxPagesPerSecond: 20, maxBodyKiB: 256 },
      getSiteUrl: () => undefined,
      emitProgress: () => {},
    });
    cron.startCron();
  });

  afterEach(() => {
    cron.stopCron();
  });

  const deferred = <T>() => {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('stops the poll when no request arrives and no run is outstanding', async () => {
    jobs.tryClaim.mockResolvedValue(false);
    jobs.isRunOutstanding.mockResolvedValue(false);

    await cron.runPendingJob();

    expect(cron.isJobRunning()).toBe(false);
  });

  it('claims again instead of stopping when the request arrives while the tick reads the job', async () => {
    const outstandingRead = deferred<boolean>();
    jobs.tryClaim.mockResolvedValue(false);
    jobs.isRunOutstanding.mockReturnValueOnce(outstandingRead.promise);
    jobs.isRunOutstanding.mockResolvedValue(true);

    const tick = cron.runPendingJob();
    await vi.waitFor(() => expect(jobs.isRunOutstanding).toHaveBeenCalled());
    const request = cron.claimNow();
    // The read was issued before the request was written, so it saw nothing outstanding.
    outstandingRead.resolve(false);
    await Promise.all([tick, request]);

    expect(jobs.tryClaim).toHaveBeenCalledTimes(2);
    expect(cron.isJobRunning()).toBe(true);
  });

  it('claims again when the request arrives while the tick is claiming', async () => {
    const claim = deferred<boolean>();
    jobs.tryClaim.mockReturnValueOnce(claim.promise);
    jobs.tryClaim.mockResolvedValue(false);
    jobs.isRunOutstanding.mockResolvedValue(true);

    const tick = cron.runPendingJob();
    const request = cron.claimNow();
    claim.resolve(false);
    await Promise.all([tick, request]);

    expect(jobs.tryClaim).toHaveBeenCalledTimes(2);
    expect(cron.isJobRunning()).toBe(true);
  });
});
