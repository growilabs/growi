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
let service: PageLinkService | undefined;

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
// shared database mid-suite and hold the worker open. The self-stop is tested on
// PageLinkBackfillCron with a schedule that never fires; here the poll runs on the real
// one-minute schedule, so each test stops it as soon as it has looked.
afterEach(() => {
  service?.backfillPoll?.stopCron();
  service = undefined;
});

const createService = (): PageLinkService => {
  const crowi = mock<Crowi>({
    configManager: {
      // mockImplementation rather than vi.fn(impl): getConfig is generic over the config key.
      getConfig: vi.fn().mockImplementation((key: string) => CONFIG[key]),
    },
    socketIoService: mock<SocketIoService>(),
  });
  service = new PageLinkService(crowi);
  return service;
};

/** Runs the boot step and reports whether it left a poll scheduled, and on what schedule. */
const bootSchedulesPoll = async (): Promise<boolean> => {
  const booted = createService();
  await booted.startBackfillPoll();
  const scheduled = booted.backfillPoll?.isJobRunning() ?? false;
  booted.backfillPoll?.stopCron();
  if (scheduled)
    expect(booted.backfillPoll?.getCronSchedule()).toBe('* * * * *');
  return scheduled;
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
    failedAttempts: 0,
    retryAt: null,
  });

const readJob = () => prisma.pagelinkbackfilljobs.findFirst({});

const readRows = () =>
  prisma.pagelinks.findMany({
    select: { fromPageId: true, toPath: true, toPageId: true },
    orderBy: [{ fromPageId: 'asc' }, { toPath: 'asc' }],
  });

describe('PageLinkService#startBackfillPoll (boot)', () => {
  it('creates the job document at rest when it is missing, and schedules no poll', async () => {
    await prisma.pagelinkbackfilljobs.deleteMany({});

    expect(await bootSchedulesPoll()).toBe(false);
    expect(await readJob()).toMatchObject({
      status: 'idle',
      coverage: 'none',
    });
  });

  it.each([
    { status: 'idle', coverage: 'none' },
    { status: 'idle', coverage: 'partial' },
    { status: 'complete', coverage: 'partial' },
    { status: 'complete', coverage: 'all' },
    { status: 'stopped', coverage: 'none' },
    { status: 'failed', coverage: 'none', retryAt: null },
  ])('schedules no poll when the job is $status (coverage $coverage, nothing to retry)', async (set) => {
    await patchJob(set);

    expect(await bootSchedulesPoll()).toBe(false);
    expect(await readJob()).toMatchObject(set);
  });

  it.each([
    { status: 'requested' },
    {
      status: 'running',
      claimedBy: 'old-pod',
      leaseExpiresAt: { $date: '2999-01-01T00:00:00Z' },
    },
    { status: 'failed', retryAt: { $date: '2999-01-01T00:00:00Z' } },
  ])('schedules the poll when the job is $status, and claims nothing itself', async (set) => {
    await requestRun('all');
    await patchJob(set);

    expect(await bootSchedulesPoll()).toBe(true);
    expect(await readJob()).toMatchObject({ status: set.status });
  });
});

describe('PageLinkService#claimBackfillNow (after the admin writes a request)', () => {
  it('starts the poll in this process and runs the request to completion without waiting for a tick', async () => {
    const a = await seedPage('/fresh/a', '[b](/fresh/b)');
    const b = await seedPage('/fresh/b', '[a](/fresh/a)');
    const booted = createService();
    await booted.startBackfillPoll();
    expect(booted.backfillPoll).toBeUndefined();
    await requestRun('all');

    await booted.claimBackfillNow();

    expect(booted.backfillPoll?.isJobRunning()).toBe(true);
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

  it('reuses the poll that boot scheduled', async () => {
    await seedPage('/again/a', '[b](/again/b)');
    await requestRun('all');
    const booted = createService();
    await booted.startBackfillPoll();
    const scheduled = booted.backfillPoll;

    await booted.claimBackfillNow();

    expect(booted.backfillPoll).toBe(scheduled);
    expect(await readJob()).toMatchObject({ status: 'complete' });
  });
});
