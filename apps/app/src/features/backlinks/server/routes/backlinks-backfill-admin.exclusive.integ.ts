import { performance } from 'node:perf_hooks';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { Prisma } from '~/generated/prisma/client';
import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import { ensurePageLinkIndexes } from '../models/page-link-indexes';
import { throwOnWriteErrors } from '../models/throw-on-write-errors';
import { PageLinkBackfillCron } from '../services/page-link-backfill-cron';
import { createBacklinksBackfillAdminRouter } from './backlinks-backfill-admin';

// Exclusive project: the job document is a singleton and the page counts span the whole
// `pages` collection, so each test empties both.

const MOUNT_PATH = '/_api/v3/backlinks-backfill';
const JOB_COLLECTION = 'pagelinkbackfilljobs';
const LEASE = { leaseMs: 60_000 };

interface FakeUser {
  readonly _id: Types.ObjectId;
  readonly status: number;
  readonly admin: boolean;
}

const ADMIN: FakeUser = {
  _id: new Types.ObjectId(),
  status: UserStatus.STATUS_ACTIVE,
  admin: true,
};
const NON_ADMIN: FakeUser = {
  ...ADMIN,
  _id: new Types.ObjectId(),
  admin: false,
};

let Page: PageModel;
let app: express.Application;
let currentUser: FakeUser | undefined;

const jobs = () => prisma.pagelinkbackfilljobs;

// --- fixtures --------------------------------------------------------------

const patchJob = async (set: Prisma.InputJsonObject): Promise<void> => {
  const result = await prisma.$runCommandRaw({
    update: JOB_COLLECTION,
    updates: [{ q: {}, u: { $set: set } }],
  });
  throwOnWriteErrors(result, 'test patch of the job document');
};

const date = (iso: string) => ({ $date: iso });

// Two Prisma reads of an unchanged row are not `toEqual`, so "changed nothing" compares the
// stored document as Extended JSON.
const readStoredJob = async (): Promise<unknown> => {
  const result = await prisma.$runCommandRaw({
    find: JOB_COLLECTION,
    filter: {},
  });
  return (result.cursor as { firstBatch: object[] }).firstBatch[0] ?? null;
};

const readJob = () => jobs().findFirst({});

/** A run a dead or live owner left mid-way, with the request it came from. */
const PREVIOUS_RUN = {
  requestedScope: {
    kind: 'since',
    maxPages: null,
    since: date('2026-02-01T00:00:00.000Z'),
  },
  requestedAt: date('2026-02-10T00:00:00.000Z'),
  runCutoff: date('2026-02-01T00:00:00.000Z'),
  runTotal: 50,
  progressMarker: { $oid: '0000000000000000000000aa' },
  processed: 20,
  skippedPages: 3,
};

const claimRunning = async (owner = 'owner-a'): Promise<void> => {
  await patchJob({ ...PREVIOUS_RUN, status: 'requested' });
  if (!(await jobs().tryClaim(owner, LEASE))) {
    throw new Error('fixture claim failed');
  }
  // The claim from `requested` clears it; a live Stop set later would not be.
  await patchJob({ stopRequested: false });
};

const expireLease = () =>
  patchJob({ leaseExpiresAt: date('2000-01-01T00:00:00.000Z') });

interface SeedPage {
  readonly path: string;
  readonly updatedAt: Date;
  /** null for a legacy page, which reads as published. */
  readonly status?: string | null;
  readonly isEmpty?: boolean;
  readonly body?: string;
}

const seedPage = async ({
  path,
  updatedAt,
  status = 'published',
  isEmpty = false,
  body,
}: SeedPage): Promise<Types.ObjectId> => {
  const id = new Types.ObjectId();
  await Page.create({ _id: id, path, grant: 1, isEmpty });
  const set: Record<string, unknown> = { updatedAt, status };
  if (body != null) {
    const revision = await prisma.revisions.create({
      data: { pageId: id.toString(), body },
    });
    set.revision = new Types.ObjectId(revision.id);
  }
  // Straight to the collection, so the fixture's updatedAt is not overwritten.
  await mongoose.connection
    .collection('pages')
    .updateOne({ _id: id }, { $set: set });
  return id;
};

const asUser = (user: FakeUser | undefined) => {
  currentUser = user;
};

const getState = () => request(app).get(MOUNT_PATH);
const post = (action: 'start' | 'stop' | 'resume', body?: object) =>
  request(app)
    .post(`${MOUNT_PATH}/${action}`)
    .send(body ?? {});

beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
  Page = PageModelFactory(null);

  const responseHelpers: { response: Record<string, unknown> } = {
    response: {},
  };
  addCustomFunctionToResponse(responseHelpers);
  app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: FakeUser }, res, next) => {
    Object.assign(res, responseHelpers.response);
    if (currentUser != null) req.user = currentUser;
    next();
  });
  // The auth middlewares read nothing from crowi for a logged-in or anonymous API caller.
  app.use(MOUNT_PATH, createBacklinksBackfillAdminRouter(mock<Crowi>()));
});

beforeEach(async () => {
  asUser(ADMIN);
  await Page.deleteMany({});
  await prisma.revisions.deleteMany({});
  await prisma.pagelinks.deleteMany({});
  await jobs().deleteMany({});
  await jobs().ensureExists();
});

// --- tests -----------------------------------------------------------------

describe('backlinks backfill admin routes', () => {
  describe('access', () => {
    const routes = [
      ['GET /', () => getState()],
      ['POST /start', () => post('start', { kind: 'all' })],
      ['POST /stop', () => post('stop')],
      ['POST /resume', () => post('resume')],
    ] as const;

    it.each(
      routes,
    )('%s refuses a guest with 403 and changes nothing', async (_route, send) => {
      await patchJob({ status: 'stopped' });
      const before = await readStoredJob();
      asUser(undefined);

      const res = await send();

      expect(res.status).toBe(403);
      expect(await readStoredJob()).toEqual(before);
    });

    it.each(
      routes,
    )('%s redirects a user who is not an admin and changes nothing', async (_route, send) => {
      await patchJob({ status: 'stopped' });
      const before = await readStoredJob();
      asUser(NON_ADMIN);

      const res = await send();

      expect(res.status).toBe(302);
      expect(res.body).not.toHaveProperty('state');
      expect(await readStoredJob()).toEqual(before);
    });
  });

  describe('GET /', () => {
    it('reports a job never started, without the claim holder', async () => {
      await seedPage({ path: '/a', updatedAt: new Date('2026-01-01') });

      const res = await getState();

      expect(res.status).toBe(200);
      expect(res.body.state).toEqual({
        status: 'idle',
        stopRequested: false,
        processed: 0,
        runTotal: null,
        skippedPages: 0,
        coverage: 'none',
        coveredSince: null,
        completedAt: null,
        lastError: null,
        notIncludedCount: 1,
        totalPageCount: 1,
      });
    });

    it('reports the progress of a running run without its claim holder', async () => {
      await claimRunning('host-1:4242:secret');

      const res = await getState();

      expect(res.body.state).toMatchObject({
        status: 'running',
        processed: 20,
        runTotal: 50,
        skippedPages: 3,
      });
      expect(JSON.stringify(res.body)).not.toContain('host-1');
    });

    it('counts, after a real partial run, the pages older than coveredSince, excluding trashed and empty ones', async () => {
      const since = new Date('2026-03-01T00:00:00.000Z');
      const older = new Date('2026-02-01T00:00:00.000Z');
      const newer = new Date('2026-04-01T00:00:00.000Z');
      const body = '[link](/new/1)';
      await seedPage({ path: '/old/1', updatedAt: older, body });
      await seedPage({ path: '/old/2', updatedAt: older, body });
      await seedPage({ path: '/old/3', updatedAt: older, status: null, body });
      await seedPage({ path: '/old/boundary', updatedAt: since, body });
      await seedPage({
        path: '/old/trashed',
        updatedAt: older,
        status: 'deleted',
        body,
      });
      await seedPage({ path: '/old/empty', updatedAt: older, isEmpty: true });
      await seedPage({ path: '/new/1', updatedAt: newer, body });
      await seedPage({
        path: '/new/trashed',
        updatedAt: newer,
        status: 'deleted',
        body,
      });

      const started = await post('start', {
        kind: 'since',
        since: since.toISOString(),
      });
      expect(started.status).toBe(200);
      await runCron();
      const res = await getState();

      expect(res.body.state).toMatchObject({
        status: 'complete',
        processed: 2,
        runTotal: 2,
        coverage: 'partial',
        coveredSince: since.toISOString(),
        notIncludedCount: 3,
        totalPageCount: 5,
      });
      expect(res.body.state.completedAt).toEqual(expect.any(String));
    });

    it('reports no page left out once coverage is all', async () => {
      await seedPage({ path: '/a', updatedAt: new Date('2026-01-01') });
      await patchJob({ status: 'complete', coverage: 'all' });

      const res = await getState();

      expect(res.body.state).toMatchObject({
        coverage: 'all',
        notIncludedCount: 0,
        totalPageCount: 1,
      });
    });

    it('recreates a missing job document as not started', async () => {
      await jobs().deleteMany({});

      const res = await getState();

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'idle',
        coverage: 'none',
      });
    });
  });

  describe('POST /start', () => {
    it.each([
      ['all', { kind: 'all' }, { kind: 'all', maxPages: null, since: null }],
      [
        'maxPages',
        { kind: 'maxPages', maxPages: 25 },
        { kind: 'maxPages', maxPages: 25, since: null },
      ],
      [
        'since',
        { kind: 'since', since: '2026-01-15T00:00:00.000Z' },
        {
          kind: 'since',
          maxPages: null,
          since: new Date('2026-01-15T00:00:00.000Z'),
        },
      ],
    ])('writes a %s request, clears the previous run and returns the state', async (_kind, body, storedScope) => {
      await patchJob({
        ...PREVIOUS_RUN,
        status: 'stopped',
        coverage: 'partial',
        coveredSince: date('2026-03-01T00:00:00.000Z'),
        lastError: 'an old failure',
      });
      const startedAt = new Date();

      const res = await post('start', body);

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'requested',
        processed: 0,
        runTotal: null,
        skippedPages: 0,
        coverage: 'partial',
        coveredSince: '2026-03-01T00:00:00.000Z',
        lastError: null,
      });
      const job = await readJob();
      expect(job).toMatchObject({
        status: 'requested',
        requestedScope: storedScope,
        stopRequested: false,
        runCutoff: null,
        runTotal: null,
        progressMarker: null,
        processed: 0,
        skippedPages: 0,
        claimedBy: null,
        leaseExpiresAt: null,
      });
      expect(job?.requestedAt?.getTime()).toBeGreaterThanOrEqual(
        startedAt.getTime() - 1000,
      );
    });

    it.each([
      'idle',
      'complete',
      'stopped',
      'failed',
    ])('accepts a start from %s as a new run', async (status) => {
      await patchJob({ ...PREVIOUS_RUN, status });

      const res = await post('start', { kind: 'all' });

      expect(res.status).toBe(200);
      // The fields that make the loop's next claim a new run rather than a resume.
      expect(await readJob()).toMatchObject({
        status: 'requested',
        runCutoff: null,
        runTotal: null,
        progressMarker: null,
        processed: 0,
        skippedPages: 0,
      });
    });

    it('takes over a run whose owner lease has expired, and refuses that owner later writes', async () => {
      await claimRunning('owner-dead');
      await expireLease();

      const res = await post('start', { kind: 'maxPages', maxPages: 5 });

      expect(res.status).toBe(200);
      expect(await readJob()).toMatchObject({
        status: 'requested',
        claimedBy: null,
        runTotal: null,
      });
      await expect(
        jobs().checkpoint(
          'owner-dead',
          { progressMarker: null, processed: 99, skippedPages: 0 },
          LEASE,
        ),
      ).resolves.toBeNull();
      expect(await readJob()).toMatchObject({
        status: 'requested',
        processed: 0,
      });
    });

    it.each([
      [
        'a run is requested',
        () => patchJob({ ...PREVIOUS_RUN, status: 'requested' }),
        'backfill_run_active',
      ],
      [
        'a run is running under a live lease',
        () => claimRunning(),
        'backfill_run_active',
      ],
      [
        'coverage is all',
        () => patchJob({ status: 'complete', coverage: 'all' }),
        'backfill_already_complete',
      ],
    ])('is refused with 409 when %s, changing nothing', async (_case, arrange, code) => {
      await arrange();
      const before = await readStoredJob();

      const res = await post('start', { kind: 'all' });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe(code);
      expect(await readStoredJob()).toEqual(before);
    });

    it.each([
      ['an unknown kind', { kind: 'newest' }],
      ['a page count given as a string', { kind: 'maxPages', maxPages: '5' }],
      ['a zero page count', { kind: 'maxPages', maxPages: 0 }],
      ['a negative page count', { kind: 'maxPages', maxPages: -1 }],
      ['a fractional page count', { kind: 'maxPages', maxPages: 2.5 }],
      ['an unparseable date', { kind: 'since', since: 'yesterday-ish' }],
      [
        'a date in the future',
        {
          kind: 'since',
          since: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    ])('is refused with 400 for %s, changing nothing', async (_case, body) => {
      await patchJob({ ...PREVIOUS_RUN, status: 'stopped' });
      const before = await readStoredJob();

      const res = await post('start', body);

      expect(res.status).toBe(400);
      expect(await readStoredJob()).toEqual(before);
    });

    it('leaves exactly one request when two starts arrive at once', async () => {
      const bodies = [{ kind: 'maxPages', maxPages: 10 }, { kind: 'all' }];

      const responses = await Promise.all(
        bodies.map((body) => post('start', body)),
      );

      expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
      const winner = bodies[responses.findIndex((res) => res.status === 200)];
      expect(await readJob()).toMatchObject({
        status: 'requested',
        requestedScope: { kind: winner.kind },
      });
    });

    it('makes a start after a stopped run walk its own range instead of resuming the old one', async () => {
      const pageIds = await Promise.all(
        ['/a', '/b', '/c', '/d'].map((path, i) =>
          seedPage({
            path,
            updatedAt: new Date(Date.UTC(2026, 0, 1 + i)),
            body: `[link](/a) ${path}`,
          }),
        ),
      );
      // A stopped `since` run past the second page, its range and total fixed.
      await patchJob({
        ...PREVIOUS_RUN,
        status: 'stopped',
        runCutoff: date('2026-01-03T00:00:00.000Z'),
        runTotal: 2,
        progressMarker: { $oid: pageIds.map(String).sort()[1] },
        processed: 2,
      });

      const res = await post('start', { kind: 'all' });
      expect(res.status).toBe(200);
      await runCron();

      expect(await readJob()).toMatchObject({
        status: 'complete',
        coverage: 'all',
        runCutoff: null,
        runTotal: 4,
        processed: 4,
      });
    });
  });

  describe('POST /stop', () => {
    it('cancels a new run request not yet claimed, returning the job to rest with coverage unchanged', async () => {
      await patchJob({
        status: 'complete',
        coverage: 'partial',
        coveredSince: date('2026-03-01T00:00:00.000Z'),
      });
      await post('start', { kind: 'all' });

      const res = await post('stop');

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'idle',
        coverage: 'partial',
        coveredSince: '2026-03-01T00:00:00.000Z',
      });
      expect(await readJob()).toMatchObject({
        status: 'idle',
        requestedScope: null,
        requestedAt: null,
        stopRequested: false,
      });
    });

    it('cancels a resume not yet claimed back to stopped, so the run can still be resumed', async () => {
      await patchJob({ ...PREVIOUS_RUN, status: 'stopped' });
      await post('resume');

      const res = await post('stop');

      expect(res.status).toBe(200);
      expect(await readJob()).toMatchObject({
        status: 'stopped',
        requestedScope: { kind: 'since' },
        runTotal: 50,
        processed: 20,
        progressMarker: '0000000000000000000000aa',
      });
      expect((await post('resume')).status).toBe(200);
    });

    it('flags a run under a live lease, leaving its claim for the loop to settle', async () => {
      await claimRunning('owner-live');

      const res = await post('stop');

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'running',
        stopRequested: true,
      });
      expect(await readJob()).toMatchObject({
        status: 'running',
        stopRequested: true,
        claimedBy: 'owner-live',
      });
      await expect(
        jobs().checkpoint(
          'owner-live',
          { progressMarker: null, processed: 21, skippedPages: 3 },
          LEASE,
        ),
      ).resolves.toEqual({ stopRequested: true });
    });

    it('ends a run whose lease has expired directly, releasing the claim and fencing out its owner', async () => {
      await claimRunning('owner-dead');
      await expireLease();

      const res = await post('stop');

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'stopped',
        stopRequested: false,
        processed: 20,
        runTotal: 50,
      });
      expect(await readJob()).toMatchObject({
        status: 'stopped',
        claimedBy: null,
        leaseExpiresAt: null,
        progressMarker: '0000000000000000000000aa',
      });
      await expect(
        jobs().checkpoint(
          'owner-dead',
          { progressMarker: null, processed: 99, skippedPages: 0 },
          LEASE,
        ),
      ).resolves.toBeNull();
      expect(await readJob()).toMatchObject({ processed: 20 });
    });

    it.each([
      'idle',
      'complete',
      'stopped',
      'failed',
    ])('is refused with 409 in %s, changing nothing', async (status) => {
      await patchJob({ ...PREVIOUS_RUN, status });
      const before = await readStoredJob();

      const res = await post('stop');

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('backfill_not_stoppable');
      expect(await readStoredJob()).toEqual(before);
    });
  });

  describe('POST /resume', () => {
    it('requests a stopped run again, keeping its scope, range, marker and counts', async () => {
      await patchJob({ ...PREVIOUS_RUN, status: 'stopped' });

      const res = await post('resume');

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'requested',
        processed: 20,
        runTotal: 50,
        skippedPages: 3,
      });
      expect(await readJob()).toMatchObject({
        status: 'requested',
        requestedScope: {
          kind: 'since',
          since: new Date('2026-02-01T00:00:00.000Z'),
        },
        runCutoff: new Date('2026-02-01T00:00:00.000Z'),
        runTotal: 50,
        progressMarker: '0000000000000000000000aa',
        processed: 20,
        skippedPages: 3,
      });
    });

    it.each([
      ['idle', () => patchJob({ status: 'idle' })],
      ['requested', () => patchJob({ ...PREVIOUS_RUN, status: 'requested' })],
      ['running', () => claimRunning()],
      ['complete', () => patchJob({ status: 'complete' })],
      ['failed', () => patchJob({ ...PREVIOUS_RUN, status: 'failed' })],
    ])('is refused with 409 in %s, changing nothing', async (_status, arrange) => {
      await arrange();
      const before = await readStoredJob();

      const res = await post('resume');

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('backfill_not_stopped');
      expect(await readStoredJob()).toEqual(before);
    });
  });
});

/** One idle tick of the real cron, at full speed (rests advance a virtual clock). */
const runCron = async (): Promise<void> => {
  let offsetMs = 0;
  const cron = new PageLinkBackfillCron({
    cronSchedule: '* * * * *',
    pacing: { dutyCyclePercent: 100, maxPagesPerSecond: 1000, maxBodyKiB: 256 },
    getSiteUrl: () => 'https://wiki.example',
    emitProgress: () => {},
    now: () => performance.now() + offsetMs,
    sleep: (ms) => {
      offsetMs += ms;
      return Promise.resolve();
    },
  });
  await cron.runPendingJob();
};
