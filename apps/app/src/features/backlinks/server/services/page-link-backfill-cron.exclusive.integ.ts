import { performance } from 'node:perf_hooks';
import mongoose, { Types } from 'mongoose';

import type { Prisma } from '~/generated/prisma/client';
import type { PageModel } from '~/server/models/page';
import PageModelFactory from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { BacklinksBackfillProgressData } from '../../interfaces/page-link-backfill';
import { ensurePageLinkIndexes } from '../models/page-link-indexes';
import { throwOnWriteErrors } from '../models/throw-on-write-errors';
import type { BackfillPacing } from './backfill-pacing';
import { PageLinkBackfillCron } from './page-link-backfill-cron';
import { handlePageUpsertById } from './page-link-service-handlers';

// Exclusive project: the walk scans the whole `pages` collection, so each test empties it.

const mocks = vi.hoisted(() => ({ extractionsOfFailingBody: 0 }));
vi.mock('./extract-internal-link-paths', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./extract-internal-link-paths')>();
  return {
    extractInternalLinkPaths: (
      markdown: string,
      pagePath: string,
      siteUrl?: string,
    ): Promise<string[]> => {
      if (markdown.includes('FAIL-EVERY-TIME')) {
        mocks.extractionsOfFailingBody += 1;
        return Promise.reject(new Error('extraction failed'));
      }
      return actual.extractInternalLinkPaths(markdown, pagePath, siteUrl);
    },
  };
});

const SITE_URL = 'https://wiki.example';
const JOB_COLLECTION = 'pagelinkbackfilljobs';

const DEFAULT_PACING: BackfillPacing = {
  dutyCyclePercent: 100,
  maxPagesPerSecond: 1000,
  maxBodyKiB: 256,
};

let Page: PageModel;

beforeAll(async () => {
  const db = mongoose.connection.db;
  if (db == null) throw new Error('no mongoose connection');
  await ensurePageLinkIndexes(db);
  Page = PageModelFactory(null);
});

beforeEach(async () => {
  mocks.extractionsOfFailingBody = 0;
  await Page.deleteMany({});
  await prisma.revisions.deleteMany({});
  await prisma.pagelinks.deleteMany({});
  await prisma.pageredirects.deleteMany({});
  await prisma.pagelinkbackfilljobs.deleteMany({});
  await prisma.pagelinkbackfilljobs.ensureExists();
});

// --- fixtures --------------------------------------------------------------

interface SeedPage {
  readonly id?: Types.ObjectId;
  readonly path: string;
  readonly body?: string;
  readonly updatedAt?: Date;
  readonly status?: string;
  readonly isEmpty?: boolean;
}

const seedPage = async ({
  id = new Types.ObjectId(),
  path,
  body,
  updatedAt = new Date('2026-01-15T00:00:00Z'),
  status = 'published',
  isEmpty = false,
}: SeedPage): Promise<Types.ObjectId> => {
  await Page.create({ _id: id, path, grant: 1, status, isEmpty });
  const set: Record<string, unknown> = { updatedAt };
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

/** Ascending ids, so the walk's `_id` order is the order they were minted in. */
const mintIds = (count: number): Types.ObjectId[] =>
  Array.from({ length: count }, () => new Types.ObjectId());

const patchJob = async (set: Prisma.InputJsonObject): Promise<void> => {
  const result = await prisma.$runCommandRaw({
    update: JOB_COLLECTION,
    updates: [{ q: {}, u: { $set: set } }],
  });
  throwOnWriteErrors(result, 'test patch of the job document');
};

type Scope =
  | { kind: 'all' }
  | { kind: 'since'; since: Date }
  | { kind: 'maxPages'; maxPages: number };

/** What the start endpoint writes for a new run: the request, with the run fields reset. */
const requestRun = (scope: Scope): Promise<void> =>
  patchJob({
    status: 'requested',
    requestedScope: {
      kind: scope.kind,
      maxPages: scope.kind === 'maxPages' ? scope.maxPages : null,
      since:
        scope.kind === 'since' ? { $date: scope.since.toISOString() } : null,
    },
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

const sourcesWithRows = async (): Promise<string[]> =>
  [...new Set((await readRows()).map((row) => row.fromPageId ?? ''))].sort();

/**
 * A cron whose clock is the real one plus a virtual offset that its sleeps advance instead of
 * waiting, so a test runs at full speed while every measured page cycle is still real. `onSleep`
 * runs inside each rest, i.e. between pages, where another actor would interleave.
 */
const createCron = ({
  pacing = DEFAULT_PACING,
  onSleep,
}: {
  pacing?: BackfillPacing;
  onSleep?: (ctx: { sleeps: number; advance: (ms: number) => void }) => unknown;
} = {}) => {
  let offsetMs = 0;
  let sleeps = 0;
  const emitted: BacklinksBackfillProgressData[] = [];
  const now = () => performance.now() + offsetMs;
  const advance = (ms: number) => {
    offsetMs += ms;
  };
  const cron = new PageLinkBackfillCron({
    cronSchedule: '* * * * *',
    pacing,
    getSiteUrl: () => SITE_URL,
    emitProgress: (data) => emitted.push(data),
    now,
    sleep: async (ms) => {
      advance(ms);
      sleeps += 1;
      await onSleep?.({ sleeps, advance });
    },
  });
  return { cron, emitted, now };
};

/** Past the checkpoint interval, so the next page ends with a checkpoint. */
const FORCE_CHECKPOINT_MS = 11_000;

// --- tests -----------------------------------------------------------------

describe('PageLinkBackfillCron (integration)', () => {
  it('does nothing when no request is pending', async () => {
    await seedPage({ path: '/idle/a', body: '[b](/idle/b)' });
    const { cron, emitted } = createCron();

    await cron.runPendingJob();

    expect(await readJob()).toMatchObject({
      status: 'idle',
      claimedBy: null,
    });
    expect(await readRows()).toEqual([]);
    expect(emitted).toEqual([]);
  });

  describe('rows', () => {
    const seedLinkedWiki = async () => {
      const [a, b, c, d, e, t] = mintIds(6);
      const ghost = new Types.ObjectId();
      await seedPage({
        id: a,
        path: '/eq/a',
        body: [
          '[b](/eq/b)',
          `[c by permalink](/${c})`,
          `[d by absolute url](${SITE_URL}/eq/d)`,
          '[missing](/eq/missing)',
          '[external](https://other.example/eq/b)',
          `[ghost permalink](/${ghost})`,
          `[self by permalink](/${a})`,
          '[empty page by path](/eq/e)',
          `[empty page by permalink](/${e})`,
          '[trashed page by path](/trash/eq/t)',
        ].join('\n\n'),
      });
      await seedPage({ id: b, path: '/eq/b', body: `[a](/${a})` });
      await seedPage({ id: c, path: '/eq/c', body: '[b](/eq/b)' });
      await seedPage({ id: d, path: '/eq/d', body: 'no links' });
      await seedPage({ id: e, path: '/eq/e', isEmpty: true });
      await seedPage({
        id: t,
        path: '/trash/eq/t',
        body: '[a](/eq/a)',
        status: 'deleted',
      });
      return { a, b, c, d, e, t };
    };

    // No redirects are seeded: the backfill deliberately does not follow them (design.md).
    it('equal the rows the live save path writes for the same pages, with no redirects involved', async () => {
      const ids = await seedLinkedWiki();
      for (const id of Object.values(ids)) {
        // biome-ignore lint/performance/noAwaitInLoops: the live drain runs pages one at a time too
        await handlePageUpsertById(id.toString(), SITE_URL);
      }
      const liveRows = await readRows();
      await prisma.pagelinks.deleteMany({});
      await requestRun({ kind: 'all' });

      await createCron().cron.runPendingJob();

      const backfilledRows = await readRows();
      expect(backfilledRows).toEqual(liveRows);
      // Guard the comparison: both kinds of same-wiki link are in it, resolved.
      expect(backfilledRows).toEqual(
        expect.arrayContaining([
          {
            fromPageId: ids.a.toString(),
            toPath: `/${ids.c}`,
            toPageId: ids.c.toString(),
          },
          {
            fromPageId: ids.a.toString(),
            toPath: '/eq/d',
            toPageId: ids.d.toString(),
          },
          {
            fromPageId: ids.a.toString(),
            toPath: `/${ids.e}`,
            toPageId: ids.e.toString(),
          },
        ]),
      );
      expect(await readJob()).toMatchObject({
        status: 'complete',
        coverage: 'all',
        claimedBy: null,
        // a, b, c, d: the empty and the trashed page are not in the walk.
        runTotal: 4,
        processed: 4,
        skippedPages: 0,
      });
    });

    it('are not duplicated by a second full run', async () => {
      await seedLinkedWiki();
      await requestRun({ kind: 'all' });
      await createCron().cron.runPendingJob();
      const firstRows = await readRows();

      await patchJob({ coverage: 'none' });
      await requestRun({ kind: 'all' });
      await createCron().cron.runPendingJob();

      expect(await readRows()).toEqual(firstRows);
    });
  });

  describe('stop, resume and claim fencing', () => {
    const seedChain = async (count: number): Promise<Types.ObjectId[]> => {
      const ids = mintIds(count);
      for (const [i, id] of ids.entries()) {
        // biome-ignore lint/performance/noAwaitInLoops: fixtures in `_id` order
        await seedPage({
          id,
          path: `/chain/${i}`,
          body: `[next](/chain/${i + 1})`,
        });
      }
      return ids;
    };

    it('stops at the checkpoint after a stop request, then resumes from the marker to completion', async () => {
      const ids = await seedChain(5);
      await requestRun({ kind: 'all' });
      const first = createCron({
        onSleep: async ({ sleeps, advance }) => {
          if (sleeps === 2) {
            await patchJob({ stopRequested: true });
            advance(FORCE_CHECKPOINT_MS);
          }
        },
      });

      await first.cron.runPendingJob();

      expect(await readJob()).toMatchObject({
        status: 'stopped',
        stopRequested: false,
        claimedBy: null,
        leaseExpiresAt: null,
        progressMarker: ids[2].toString(),
        processed: 3,
        runTotal: 5,
      });
      expect(await sourcesWithRows()).toEqual(
        ids.slice(0, 3).map(String).sort(),
      );
      expect(first.emitted.at(-1)).toMatchObject({
        status: 'stopped',
        processed: 3,
        runTotal: 5,
      });

      // Resume: back to `requested`, run fields kept.
      await patchJob({ status: 'requested' });
      const second = createCron();
      await second.cron.runPendingJob();

      expect(await readJob()).toMatchObject({
        status: 'complete',
        processed: 5,
        runTotal: 5,
        coverage: 'all',
      });
      expect(await sourcesWithRows()).toEqual(ids.map(String).sort());
      expect(await prisma.pagelinks.count()).toBe(5);
    });

    it('stops without writing once another instance has taken the claim over', async () => {
      const ids = await seedChain(5);
      await requestRun({ kind: 'all' });
      const { cron, emitted } = createCron({
        onSleep: async ({ sleeps, advance }) => {
          if (sleeps === 2) {
            await patchJob({ claimedBy: 'other-instance' });
            advance(FORCE_CHECKPOINT_MS);
          }
        },
      });

      await cron.runPendingJob();

      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: 'other-instance',
        lastError: null,
        progressMarker: null,
        processed: 0,
      });
      // The page that ran into the refused checkpoint is the last one walked.
      expect(await sourcesWithRows()).toEqual(
        ids.slice(0, 3).map(String).sort(),
      );
      expect(emitted.map((e) => e.status)).not.toContain('complete');
    });

    it('stops and recreates the job document idle when it is gone at a checkpoint', async () => {
      await seedChain(4);
      await requestRun({ kind: 'all' });
      const { cron } = createCron({
        onSleep: async ({ sleeps, advance }) => {
          if (sleeps === 1) {
            await prisma.pagelinkbackfilljobs.deleteMany({});
            advance(FORCE_CHECKPOINT_MS);
          }
        },
      });

      await cron.runPendingJob();

      expect(await prisma.pagelinkbackfilljobs.count()).toBe(1);
      expect(await readJob()).toMatchObject({
        status: 'idle',
        coverage: 'none',
        claimedBy: null,
      });
      expect(await sourcesWithRows()).toHaveLength(2);
    });

    it('starts no second loop while one is running in this process', async () => {
      await seedChain(3);
      await requestRun({ kind: 'all' });
      let ownerBefore: string | null | undefined;
      let ownerAfter: string | null | undefined;
      const { cron } = createCron({
        onSleep: async ({ sleeps }) => {
          if (sleeps !== 1) return;
          // Make the job claimable again, as a tick falling due mid-run would find it once the
          // lease has lapsed; only the in-process guard keeps the tick out.
          await patchJob({ leaseExpiresAt: { $date: '2000-01-01T00:00:00Z' } });
          ownerBefore = (await readJob())?.claimedBy;
          await cron.runPendingJob();
          ownerAfter = (await readJob())?.claimedBy;
        },
      });

      await cron.runPendingJob();

      expect(ownerBefore).toEqual(expect.any(String));
      expect(ownerAfter).toBe(ownerBefore);
      expect(await readJob()).toMatchObject({
        status: 'complete',
        processed: 3,
      });
    });
  });

  it('emits processed of runTotal on the admin channel at each checkpoint and at the end', async () => {
    for (const i of [0, 1, 2]) {
      // biome-ignore lint/performance/noAwaitInLoops: fixtures in `_id` order
      await seedPage({ path: `/progress/${i}`, body: 'no links' });
    }
    await requestRun({ kind: 'all' });
    const { cron, emitted } = createCron({
      onSleep: ({ advance }) => advance(FORCE_CHECKPOINT_MS),
    });

    await cron.runPendingJob();

    expect(emitted).toEqual([
      { status: 'running', processed: 0, runTotal: 3, skippedPages: 0 },
      // The first page ends before any time has passed, so its checkpoint waits for the second.
      { status: 'running', processed: 2, runTotal: 3, skippedPages: 0 },
      { status: 'running', processed: 3, runTotal: 3, skippedPages: 0 },
      { status: 'complete', processed: 3, runTotal: 3, skippedPages: 0 },
    ]);
  });

  it('checkpoints after every 100 pages, before the checkpoint interval has passed', async () => {
    const ids = mintIds(101);
    // Raw inserts: a hundred bodiless pages are enough, and far faster to seed one by one.
    await mongoose.connection.collection('pages').insertMany(
      ids.map((_id, i) => ({
        _id,
        path: `/many/${i}`,
        grant: 1,
        status: 'published',
        isEmpty: false,
        updatedAt: new Date('2026-01-15T00:00:00Z'),
      })),
    );
    await requestRun({ kind: 'all' });
    const savedAfterPage = new Map<
      number,
      { processed?: number; marker?: string | null }
    >();
    const { cron } = createCron({
      onSleep: async ({ sleeps }) => {
        if (sleeps !== 99 && sleeps !== 100) return;
        const job = await readJob();
        savedAfterPage.set(sleeps, {
          processed: job?.processed,
          marker: job?.progressMarker,
        });
      },
    });

    await cron.runPendingJob();

    // Nothing saved through page 99: the interval has not passed (the virtual rests add ~0.1 s).
    expect(savedAfterPage.get(99)).toEqual({ processed: 0, marker: null });
    expect(savedAfterPage.get(100)).toEqual({
      processed: 100,
      marker: ids[99].toString(),
    });
    expect(await readJob()).toMatchObject({
      status: 'complete',
      processed: 101,
    });
  });

  it('never starts pages faster than backfillMaxPagesPerSecond, however cheap they are', async () => {
    for (const i of Array.from({ length: 8 }, (_, n) => n)) {
      // biome-ignore lint/performance/noAwaitInLoops: fixtures in `_id` order
      await seedPage({ path: `/tiny/${i}`, body: 'x' });
    }
    await requestRun({ kind: 'all' });
    const pacing = { ...DEFAULT_PACING, maxPagesPerSecond: 20 };
    const pageStarts: number[] = [];
    const { cron, now } = createCron({
      pacing,
      onSleep: () => {
        pageStarts.push(now());
      },
    });

    await cron.runPendingJob();

    expect(pageStarts).toHaveLength(8);
    const gaps = pageStarts.slice(1).map((t, i) => t - pageStarts[i]);
    for (const gap of gaps) {
      // Less a float rounding margin: the gap and the rest are sums of the same clock readings.
      expect(gap).toBeGreaterThanOrEqual(
        1000 / pacing.maxPagesPerSecond - 1e-6,
      );
    }
  });

  describe('scope', () => {
    const MONTHS = [1, 2, 3, 4, 5, 6].map(
      (m) => new Date(`2026-0${m}-01T00:00:00Z`),
    );

    /** One page per month, oldest first by `updatedAt` but minted newest first by `_id`. */
    const seedMonthly = async (): Promise<Map<number, string>> => {
      const idByMonth = new Map<number, string>();
      for (const [i, updatedAt] of [...MONTHS.entries()].reverse()) {
        // biome-ignore lint/performance/noAwaitInLoops: fixtures in `_id` order
        const id = await seedPage({
          path: `/monthly/${i + 1}`,
          body: '[target](/monthly/target)',
          updatedAt,
        });
        idByMonth.set(i + 1, id.toString());
      }
      return idByMonth;
    };
    const idsOfMonths = (idByMonth: Map<number, string>, months: number[]) =>
      months.map((m) => idByMonth.get(m)).sort();

    it.each<[string, Scope, number[], object]>([
      ['all pages', { kind: 'all' }, [1, 2, 3, 4, 5, 6], { coverage: 'all' }],
      [
        'pages edited since a date',
        { kind: 'since', since: MONTHS[3] },
        [4, 5, 6],
        { coverage: 'partial', coveredSince: MONTHS[3] },
      ],
      [
        'the newest N pages',
        { kind: 'maxPages', maxPages: 2 },
        [5, 6],
        { coverage: 'partial', coveredSince: MONTHS[4] },
      ],
      [
        'more newest pages than the wiki has',
        { kind: 'maxPages', maxPages: 50 },
        [1, 2, 3, 4, 5, 6],
        { coverage: 'all' },
      ],
    ])('%s processes only the pages in range and records the coverage', async (_name, scope, months, coverage) => {
      const idByMonth = await seedMonthly();
      await requestRun(scope);

      await createCron().cron.runPendingJob();

      expect(await sourcesWithRows()).toEqual(idsOfMonths(idByMonth, months));
      expect(await readJob()).toMatchObject({
        status: 'complete',
        runTotal: months.length,
        processed: months.length,
        ...coverage,
      });
    });

    it('walks only the gap on a wider second run and widens the coverage', async () => {
      const idByMonth = await seedMonthly();
      await requestRun({ kind: 'since', since: MONTHS[3] });
      await createCron().cron.runPendingJob();
      await prisma.pagelinks.deleteMany({});

      await requestRun({ kind: 'since', since: MONTHS[1] });
      await createCron().cron.runPendingJob();

      expect(await sourcesWithRows()).toEqual(idsOfMonths(idByMonth, [2, 3]));
      expect(await readJob()).toMatchObject({
        runTotal: 2,
        coverage: 'partial',
        coveredSince: MONTHS[1],
      });

      await prisma.pagelinks.deleteMany({});
      await requestRun({ kind: 'all' });
      await createCron().cron.runPendingJob();

      expect(await sourcesWithRows()).toEqual(idsOfMonths(idByMonth, [1]));
      expect(await readJob()).toMatchObject({ runTotal: 1, coverage: 'all' });
    });

    it('finishes at once, changing nothing, for a scope already covered', async () => {
      await seedMonthly();
      await requestRun({ kind: 'since', since: MONTHS[1] });
      await createCron().cron.runPendingJob();
      await prisma.pagelinks.deleteMany({});

      await requestRun({ kind: 'since', since: MONTHS[3] });
      await createCron().cron.runPendingJob();

      expect(await readRows()).toEqual([]);
      expect(await readJob()).toMatchObject({
        status: 'complete',
        runTotal: 0,
        processed: 0,
        coverage: 'partial',
        coveredSince: MONTHS[1],
      });
    });
  });

  describe('pages it cannot index', () => {
    it('skips a page whose every attempt fails, counts it, and completes the walk', async () => {
      const [ok1, bad, ok2] = mintIds(3);
      await seedPage({ id: ok1, path: '/f/1', body: '[x](/f/x)' });
      await seedPage({ id: bad, path: '/f/2', body: 'FAIL-EVERY-TIME' });
      await seedPage({ id: ok2, path: '/f/3', body: '[x](/f/x)' });
      await requestRun({ kind: 'all' });

      await createCron().cron.runPendingJob();

      expect(mocks.extractionsOfFailingBody).toBe(5);
      expect(await sourcesWithRows()).toEqual([ok1, ok2].map(String).sort());
      expect(await readJob()).toMatchObject({
        status: 'complete',
        processed: 3,
        skippedPages: 1,
      });
    });

    it('skips a page whose body is over the size cap without parsing it', async () => {
      const [small, large] = mintIds(2);
      await seedPage({ id: small, path: '/cap/small', body: '[x](/cap/x)' });
      await seedPage({
        id: large,
        path: '/cap/large',
        body: `[x](/cap/x)\n\n${'a'.repeat(2048)}`,
      });
      await requestRun({ kind: 'all' });

      await createCron({
        pacing: { ...DEFAULT_PACING, maxBodyKiB: 1 },
      }).cron.runPendingJob();

      expect(await sourcesWithRows()).toEqual([small.toString()]);
      expect(await readJob()).toMatchObject({
        status: 'complete',
        processed: 2,
        skippedPages: 1,
      });
    });
  });

  // One instance for both ticks: the second is the same poll's next tick, which must not be
  // shut out by the first run's in-process guard.
  it('records a failed run and retries it from the next tick', async () => {
    await seedPage({ path: '/retry/a', body: '[x](/retry/x)' });
    await patchJob({
      status: 'requested',
      requestedScope: { kind: 'no-such-scope', maxPages: null, since: null },
    });
    const { cron } = createCron();

    await cron.runPendingJob();

    expect(await readJob()).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/unknown backfill scope/),
      claimedBy: null,
    });

    await patchJob({
      requestedScope: { kind: 'all', maxPages: null, since: null },
    });
    await cron.runPendingJob();

    expect(await readJob()).toMatchObject({
      status: 'complete',
      coverage: 'all',
      processed: 1,
    });
  });
});
