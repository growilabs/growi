import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { Prisma } from '~/generated/prisma/client';
import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import type { SocketIoService } from '~/server/service/socket-io';
import { prisma } from '~/utils/prisma';

import { ensurePageLinkIndexes } from '../models/page-link-indexes';
import { throwOnWriteErrors } from '../models/throw-on-write-errors';
import type { PageLinkBackfillCron } from './page-link-backfill-cron';
import { PageLinkService } from './page-link-service';

// Exclusive project: a run walks the whole `pages` collection, so each test empties it.

const SITE_URL = 'https://wiki.example';
const JOB_COLLECTION = 'pagelinkbackfilljobs';

const CONFIG: Record<string, string | number> = {
  'app:siteUrl': SITE_URL,
  'backlinks:drainIntervalMs': 1000,
  'backlinks:dutyCyclePercent': 25,
  // Boot builds the poll with real rests, so pace it to finish a handful of pages at once.
  'backlinks:backfillDutyCyclePercent': 100,
  'backlinks:backfillMaxPagesPerSecond': 1000,
  'backlinks:backfillMaxBodyKiB': 256,
};

let Page: PageModel;
let poll: PageLinkBackfillCron | null = null;

beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
  Page = PageModelFactory(null);
});

beforeEach(async () => {
  await Page.deleteMany({});
  await prisma.revisions.deleteMany({});
  await prisma.pagelinks.deleteMany({});
  await prisma.pagelinkbackfilljobs.deleteMany({});
  await prisma.pagelinkbackfilljobs.ensureExists();
});

// node-cron keeps a ref'd timer per started task; a poll left running would tick against the
// shared database mid-suite and hold the worker open. Tests that drive ticks by hand stop the
// scheduler first, so a real minute-boundary tick cannot claim the job between them.
afterEach(() => {
  poll?.stopCron();
  poll = null;
});

const startPollAtBoot = async (): Promise<PageLinkBackfillCron | null> => {
  const crowi = mock<Crowi>({
    configManager: {
      // mockImplementation rather than vi.fn(impl): getConfig is generic over the config key.
      getConfig: vi.fn().mockImplementation((key: string) => CONFIG[key]),
    },
    socketIoService: mock<SocketIoService>(),
  });
  poll = await new PageLinkService(crowi).startBackfillPoll();
  return poll;
};

const seedPage = async (
  path: string,
  body: string,
): Promise<Types.ObjectId> => {
  const id = new Types.ObjectId();
  const revision = await prisma.revisions.create({
    data: { pageId: id.toString(), body },
  });
  await Page.create({
    _id: id,
    path,
    grant: 1,
    revision: new Types.ObjectId(revision.id),
  });
  return id;
};

const patchJob = async (set: Prisma.InputJsonObject): Promise<void> => {
  const result = await prisma.$runCommandRaw({
    update: JOB_COLLECTION,
    updates: [{ q: {}, u: { $set: set } }],
  });
  throwOnWriteErrors(result, 'test patch of the job document');
};

/** What the start endpoint writes: the request, with the run fields reset. */
const requestRun = (kind: string): Promise<void> =>
  patchJob({
    status: 'requested',
    requestedScope: { kind, maxPages: null, since: null },
    requestedAt: { $date: new Date().toISOString() },
    runCutoff: null,
    runTotal: null,
    progressMarker: null,
    processed: 0,
    skippedPages: 0,
  });

const readJob = () => prisma.pagelinkbackfilljobs.findFirst({});

const readRows = () =>
  prisma.pagelinks.findMany({
    select: { fromPageId: true, toPath: true, toPageId: true },
    orderBy: [{ fromPageId: 'asc' }, { toPath: 'asc' }],
  });

describe('PageLinkService#startBackfillPoll (boot registration)', () => {
  it('creates the job document at rest when it is missing, and starts the poll', async () => {
    await prisma.pagelinkbackfilljobs.deleteMany({});

    const started = await startPollAtBoot();

    expect(await readJob()).toMatchObject({
      status: 'idle',
      coverage: 'none',
    });
    expect(started?.isJobRunning()).toBe(true);
  });

  it('schedules no poll and leaves the document as it is when coverage is already all', async () => {
    await patchJob({ status: 'complete', coverage: 'all' });

    expect(await startPollAtBoot()).toBeNull();
    expect(await readJob()).toMatchObject({
      status: 'complete',
      coverage: 'all',
    });
  });

  it('starts the poll over a partial coverage, keeping that coverage', async () => {
    await patchJob({ status: 'complete', coverage: 'partial' });

    const started = await startPollAtBoot();

    expect(started?.isJobRunning()).toBe(true);
    expect(await readJob()).toMatchObject({ coverage: 'partial' });
  });

  it('polls every minute, and a tick starts nothing while no request is pending', async () => {
    await seedPage('/idle/a', '[b](/idle/b)');

    const started = await startPollAtBoot();
    expect(started?.isJobRunning()).toBe(true);
    expect(started?.getCronSchedule()).toBe('* * * * *');
    started?.stopCron();
    await started?.executeJob();

    expect(await readJob()).toMatchObject({
      status: 'idle',
      claimedBy: null,
    });
    expect(await readRows()).toEqual([]);
  });

  it('claims a pending request on the next tick and runs it to completion', async () => {
    const a = await seedPage('/fresh/a', '[b](/fresh/b)');
    const b = await seedPage('/fresh/b', '[a](/fresh/a)');
    await requestRun('all');

    const started = await startPollAtBoot();
    expect(started?.isJobRunning()).toBe(true);
    started?.stopCron();
    await started?.executeJob();

    expect(await readJob()).toMatchObject({
      status: 'complete',
      coverage: 'all',
      processed: 2,
      runTotal: 2,
      claimedBy: null,
    });
    expect(await readRows()).toEqual(
      [
        {
          fromPageId: a.toString(),
          toPath: '/fresh/b',
          toPageId: b.toString(),
        },
        {
          fromPageId: b.toString(),
          toPath: '/fresh/a',
          toPageId: a.toString(),
        },
      ].sort((x, y) => x.fromPageId.localeCompare(y.fromPageId)),
    );
  });

  it('retries a failed run on the next tick', async () => {
    await seedPage('/retry/a', '[x](/retry/x)');
    await requestRun('no-such-scope');

    const started = await startPollAtBoot();
    expect(started?.isJobRunning()).toBe(true);
    started?.stopCron();
    await started?.executeJob();

    expect(await readJob()).toMatchObject({ status: 'failed' });

    await patchJob({
      requestedScope: { kind: 'all', maxPages: null, since: null },
    });
    await started?.executeJob();

    expect(await readJob()).toMatchObject({
      status: 'complete',
      coverage: 'all',
    });
  });
});
