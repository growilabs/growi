import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import express from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type { Prisma } from '~/generated/prisma/client';
import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import ActivityService from '~/server/service/activity';
import type { SocketIoService } from '~/server/service/socket-io';
import { prisma } from '~/utils/prisma';

import { ensurePageLinkIndexes } from '../models/page-link-indexes';
import { throwOnWriteErrors } from '../models/throw-on-write-errors';
import { PageLinkBackfillCron } from '../services/page-link-backfill-cron';
import { PageLinkService } from '../services/page-link-service';
import { createBacklinksBackfillAdminRouter } from './backlinks-backfill-admin';

// A real minute-boundary tick would race the assertions: the tick after a finished run stops
// the poll. Due only at New Year's midnight, the poll stays armed but never fires here.
const { NEVER_DURING_TEST } = vi.hoisted(() => ({
  NEVER_DURING_TEST: '0 0 1 1 *',
}));
vi.mock('../services/page-link-backfill-cron', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../services/page-link-backfill-cron')
  >()),
  BACKFILL_POLL_CRON_SCHEDULE: NEVER_DURING_TEST,
}));

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

// One emitter for the routes and a real ActivityService, so an emitted action is settled into
// an `activities` row the way it is in the app.
const activityEvents = new EventEmitter();
const AUDIT_CONFIG: Record<string, unknown> = {
  'app:auditLogEnabled': true,
  'app:auditLogActionGroupSize': ActionGroupSize.Large,
};

// Assigned after mock<Crowi>(): an override object is deep-proxied, which would wrap the real
// emitter and service instead of handing them over.
/** What happened, in order: an emitted action and the response being sent. */
const sequence: string[] = [];
activityEvents.prependListener('update', () => {
  sequence.push('emit');
});

const crowiWith = (pageLinkService: PageLinkService): Crowi => {
  const crowi = mock<Crowi>();
  crowi.events.activity = activityEvents;
  crowi.pageLinkService = pageLinkService;
  return crowi;
};

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

/** The previous run failed, and the poll will retry it on its own. */
const FAILED_WITH_RETRY_DUE = {
  ...PREVIOUS_RUN,
  status: 'failed',
  lastError: 'db down',
  failedAttempts: 2,
  retryAt: date('2999-01-01T00:00:00.000Z'),
};

/** The previous run failed and will not be retried: its retries are used up. */
const FAILED_NOT_RETRIED = {
  ...PREVIOUS_RUN,
  status: 'failed',
  lastError: 'db down',
  failedAttempts: 4,
  retryAt: null,
};

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

/** The router mounted behind a stub of the session middleware, on its own app. */
const buildApp = (crowi: Crowi): express.Application => {
  const responseHelpers: { response: Record<string, unknown> } = {
    response: {},
  };
  addCustomFunctionToResponse(responseHelpers);
  const built = express();
  built.use(express.json());
  built.use((req: express.Request & { user?: FakeUser }, res, next) => {
    Object.assign(res, responseHelpers.response);
    // The apiv3 helpers were just assigned above; the type cannot follow Object.assign.
    const apiv3Res = res as ApiV3Response;
    const { apiv3 } = apiv3Res;
    apiv3Res.apiv3 = (...args) => {
      sequence.push('response');
      return apiv3.apply(res, args);
    };
    if (currentUser != null) req.user = currentUser;
    next();
  });
  built.use(MOUNT_PATH, createBacklinksBackfillAdminRouter(crowi));
  return built;
};

beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
  Page = PageModelFactory(null);

  const activityCrowi = mock<Crowi>({
    configManager: {
      // mockImplementation rather than vi.fn(impl): getConfig is generic over the key.
      getConfig: vi.fn().mockImplementation((key: string) => AUDIT_CONFIG[key]),
    },
  });
  activityCrowi.events.activity = activityEvents;
  new ActivityService(activityCrowi);

  // The auth middlewares read nothing from crowi for a logged-in or anonymous API caller. The
  // stubbed service claims nothing, so these tests see the document as the routes wrote it.
  app = buildApp(crowiWith(mock<PageLinkService>()));
});

beforeEach(async () => {
  asUser(ADMIN);
  await Page.deleteMany({});
  await prisma.revisions.deleteMany({});
  await prisma.pagelinks.deleteMany({});
  await jobs().deleteMany({});
  await jobs().ensureExists();
  await prisma.activities.deleteMany({});
  sequence.length = 0;
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
        failedAttempts: 0,
        retryAt: null,
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

    it('reports a failed run waiting to retry with its count and retry time', async () => {
      await patchJob(FAILED_WITH_RETRY_DUE);

      const res = await getState();

      expect(res.body.state).toMatchObject({
        status: 'failed',
        lastError: 'db down',
        failedAttempts: 2,
        retryAt: '2999-01-01T00:00:00.000Z',
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
      ['idle', { ...PREVIOUS_RUN, status: 'idle' }],
      ['complete', { ...PREVIOUS_RUN, status: 'complete' }],
      ['stopped', { ...PREVIOUS_RUN, status: 'stopped' }],
      ['failed and not retried', FAILED_NOT_RETRIED],
    ])('accepts a start from %s as a new run', async (_case, previous) => {
      await patchJob(previous);

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
        failedAttempts: 0,
        retryAt: null,
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
        'a failed run is waiting to retry',
        () => patchJob(FAILED_WITH_RETRY_DUE),
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

    it('cancels a resume of a failed run not yet claimed to stopped, keeping its progress', async () => {
      await patchJob(FAILED_NOT_RETRIED);
      await post('resume');

      const res = await post('stop');

      expect(res.status).toBe(200);
      expect(await readJob()).toMatchObject({
        status: 'stopped',
        runTotal: 50,
        processed: 20,
        progressMarker: '0000000000000000000000aa',
      });
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

    it('ends a failed run waiting to retry as stopped, cancelling the retry and keeping its progress', async () => {
      await patchJob(FAILED_WITH_RETRY_DUE);

      const res = await post('stop');

      expect(res.status).toBe(200);
      expect(res.body.state).toMatchObject({
        status: 'stopped',
        failedAttempts: 0,
        retryAt: null,
        processed: 20,
      });
      expect(await readJob()).toMatchObject({
        status: 'stopped',
        stopRequested: false,
        claimedBy: null,
        progressMarker: '0000000000000000000000aa',
        runTotal: 50,
      });
      expect(await jobs().tryClaim('poll', LEASE)).toBe(false);
    });

    it.each([
      ['idle', { ...PREVIOUS_RUN, status: 'idle' }],
      ['complete', { ...PREVIOUS_RUN, status: 'complete' }],
      ['stopped', { ...PREVIOUS_RUN, status: 'stopped' }],
      ['failed and not retried', FAILED_NOT_RETRIED],
    ])('is refused with 409 in %s, changing nothing', async (_case, previous) => {
      await patchJob(previous);
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
      ['not retried', FAILED_NOT_RETRIED],
      ['waiting to retry', FAILED_WITH_RETRY_DUE],
    ])('requests a failed run (%s) again from its marker, with its retries restored', async (_case, previous) => {
      await patchJob(previous);

      const res = await post('resume');

      expect(res.status).toBe(200);
      expect(await readJob()).toMatchObject({
        status: 'requested',
        failedAttempts: 0,
        retryAt: null,
        lastError: null,
        runTotal: 50,
        progressMarker: '0000000000000000000000aa',
        processed: 20,
      });
    });

    it.each([
      ['idle', () => patchJob({ status: 'idle' })],
      ['requested', () => patchJob({ ...PREVIOUS_RUN, status: 'requested' })],
      ['running', () => claimRunning()],
      ['complete', () => patchJob({ status: 'complete' })],
    ])('is refused with 409 in %s, changing nothing', async (_status, arrange) => {
      await arrange();
      const before = await readStoredJob();

      const res = await post('resume');

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('backfill_not_resumable');
      expect(await readStoredJob()).toEqual(before);
    });
  });
});

describe('backlinks backfill admin routes, audit log', () => {
  // The listener settles the row after the response, so a read polls for it.
  const waitForActivities = (endpoint: string) =>
    vi.waitFor(
      async () => {
        const rows = await prisma.activities.findMany({ where: { endpoint } });
        expect(rows).not.toHaveLength(0);
        return rows;
      },
      { timeout: 5000, interval: 50 },
    );

  it.each([
    [
      'start',
      SupportedAction.ACTION_ADMIN_BACKLINKS_BACKFILL_START,
      async () => {},
      { kind: 'all' },
    ],
    [
      'stop',
      SupportedAction.ACTION_ADMIN_BACKLINKS_BACKFILL_STOP,
      () => patchJob({ ...PREVIOUS_RUN, status: 'requested' }),
      undefined,
    ],
    [
      'resume',
      SupportedAction.ACTION_ADMIN_BACKLINKS_BACKFILL_RESUME,
      () => patchJob({ ...PREVIOUS_RUN, status: 'stopped' }),
      undefined,
    ],
  ] as const)('records %s with the admin who did it', async (action, recorded, arrange, body) => {
    await arrange();

    const res = await post(action, body);

    expect(res.status).toBe(200);
    // The listener takes the operator synchronously; after the response it may be gone.
    expect(sequence).toEqual(['emit', 'response']);
    const rows = await waitForActivities(`${MOUNT_PATH}/${action}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: recorded,
      userId: ADMIN._id.toString(),
    });
  });

  const requestPending = () =>
    patchJob({ ...PREVIOUS_RUN, status: 'requested' });
  const atRest = () => patchJob({ status: 'idle' });

  it.each([
    [
      'a start refused while a run is active',
      'start',
      requestPending,
      { kind: 'all' },
    ],
    ['a start with an invalid scope', 'start', atRest, { kind: 'newest' }],
    ['a stop with nothing to stop', 'stop', atRest, undefined],
    [
      'a resume of a run that is not stopped or failed',
      'resume',
      requestPending,
      undefined,
    ],
  ] as const)('records %s as an unsettled attempt by the admin', async (_case, action, arrange, body) => {
    await arrange();

    const res = await post(action, body);

    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = await waitForActivities(`${MOUNT_PATH}/${action}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: SupportedAction.ACTION_UNSETTLED,
      userId: ADMIN._id.toString(),
    });
  });

  it('records nothing for reading the state', async () => {
    const res = await getState();

    expect(res.status).toBe(200);
    // Long enough for a stray emit to settle, as the positive cases above do.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.activities.count()).toBe(0);
  });
});

describe('backlinks backfill admin routes, with the real PageLinkService', () => {
  // Paced to finish a handful of pages at once.
  const CONFIG: Record<string, string | number> = {
    'app:siteUrl': 'https://wiki.example',
    'backlinks:drainIntervalMs': 1000,
    'backlinks:dutyCyclePercent': 25,
    'backlinks:backfillDutyCyclePercent': 100,
    'backlinks:backfillMaxPagesPerSecond': 1000,
    'backlinks:backfillMaxBodyKiB': 256,
  };
  let service: PageLinkService;
  let appWithService: express.Application;

  beforeEach(() => {
    service = new PageLinkService(
      mock<Crowi>({
        configManager: {
          // mockImplementation rather than vi.fn(impl): getConfig is generic over the key.
          getConfig: vi.fn().mockImplementation((key: string) => CONFIG[key]),
        },
        socketIoService: mock<SocketIoService>(),
      }),
    );
    appWithService = buildApp(crowiWith(service));
  });

  afterEach(() => {
    service.backfillPoll?.stopCron();
  });

  const postWithService = (action: 'start' | 'resume', body?: object) =>
    request(appWithService)
      .post(`${MOUNT_PATH}/${action}`)
      .send(body ?? {});

  const waitForStatus = (status: string) =>
    vi.waitFor(async () => expect(await readJob()).toMatchObject({ status }), {
      timeout: 5000,
      interval: 50,
    });

  it.each([
    ['a start', () => postWithService('start', { kind: 'all' })],
    [
      'a resume',
      async () => {
        await patchJob({ status: 'stopped', requestedScope: { kind: 'all' } });
        return postWithService('resume');
      },
    ],
  ])('runs %s in this process without waiting for a tick, and leaves the poll running', async (_case, send) => {
    await seedPage({
      path: '/now/a',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      body: '[b](/now/b)',
    });
    expect(service.backfillPoll).toBeUndefined();

    const res = await send();

    expect(res.status).toBe(200);
    await waitForStatus('complete');
    expect(await readJob()).toMatchObject({ coverage: 'all', processed: 1 });
    expect(service.backfillPoll?.isJobRunning()).toBe(true);
  });

  it('starts a run after the job document was deleted at runtime', async () => {
    await jobs().deleteMany({});

    const res = await postWithService('start', { kind: 'all' });

    expect(res.status).toBe(200);
    await waitForStatus('complete');
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
