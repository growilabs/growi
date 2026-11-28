import { Types } from 'mongoose';

import type { Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

import { throwOnWriteErrors } from './throw-on-write-errors';

const COLLECTION = 'pagelinkbackfilljobs';
const LEASE_MS = 60_000;
const RETRY_DELAYS_MS = [60_000, 120_000];

// Writes the way an admin endpoint and a crashed owner leave the document:
// a field-level $set straight into MongoDB, not through the model under test.
const patchJobDocument = async (set: Prisma.InputJsonObject): Promise<void> => {
  const result = await prisma.$runCommandRaw({
    update: COLLECTION,
    updates: [{ q: {}, u: { $set: set } }],
  });
  throwOnWriteErrors(result, 'test patch of the job document');
};

const expireLease = () =>
  patchJobDocument({ leaseExpiresAt: { $date: '2000-01-01T00:00:00Z' } });

const readJob = () => prisma.pagelinkbackfilljobs.findFirst({});

// The stored document as plain Extended JSON: two Prisma reads of an unchanged row are not
// `toEqual` (computed aliases), so "changed nothing" is asserted on this instead.
const readStoredJob = async (): Promise<unknown> => {
  const result = await prisma.$runCommandRaw({
    find: COLLECTION,
    filter: {},
  });
  return (result.cursor as { firstBatch: object[] }).firstBatch[0] ?? null;
};

// Raw inserts get no schema `@default`, so `ensureExists` must write every field itself. A
// Prisma read cannot show a missing one: it reports a never-written field as null or its default.
const readStoredFieldNames = async (): Promise<string[]> => {
  const result = await prisma.$runCommandRaw({
    find: COLLECTION,
    filter: {},
  });
  const [doc] = (result.cursor as { firstBatch: object[] }).firstBatch;
  return Object.keys(doc).sort();
};

describe('pagelinkbackfilljobs (integration)', () => {
  beforeEach(async () => {
    await prisma.pagelinkbackfilljobs.deleteMany({});
  });

  describe('ensureExists', () => {
    it('creates one idle document with no coverage and no request', async () => {
      await prisma.pagelinkbackfilljobs.ensureExists();

      expect(await prisma.pagelinkbackfilljobs.count()).toBe(1);
      expect(await readJob()).toMatchObject({
        status: 'idle',
        requestedScope: null,
        requestedAt: null,
        stopRequested: false,
        runCutoff: null,
        runTotal: null,
        coverage: 'none',
        coveredSince: null,
        progressMarker: null,
        processed: 0,
        skippedPages: 0,
        completedAt: null,
        lastError: null,
        claimedBy: null,
        leaseExpiresAt: null,
      });
    });

    it('stores every field of the document contract, including the empty ones', async () => {
      await prisma.pagelinkbackfilljobs.ensureExists();

      expect(await readStoredFieldNames()).toEqual(
        [
          '_id',
          'status',
          'requestedScope',
          'requestedAt',
          'stopRequested',
          'runCutoff',
          'runTotal',
          'coverage',
          'coveredSince',
          'progressMarker',
          'processed',
          'skippedPages',
          'completedAt',
          'lastError',
          'failedAttempts',
          'retryAt',
          'claimedBy',
          'leaseExpiresAt',
        ].sort(),
      );
    });

    it('leaves coverage and the progress fields untouched on a later boot', async () => {
      await prisma.pagelinkbackfilljobs.ensureExists();
      const marker = new Types.ObjectId();
      await patchJobDocument({
        status: 'stopped',
        coverage: 'partial',
        coveredSince: { $date: '2026-01-01T00:00:00Z' },
        progressMarker: { $oid: marker.toString() },
        processed: 120,
      });

      await prisma.pagelinkbackfilljobs.ensureExists();

      expect(await prisma.pagelinkbackfilljobs.count()).toBe(1);
      expect(await readJob()).toMatchObject({
        status: 'stopped',
        coverage: 'partial',
        coveredSince: new Date('2026-01-01T00:00:00Z'),
        progressMarker: marker.toString(),
        processed: 120,
      });
    });

    it('leaves exactly one document when several instances boot at once', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          prisma.pagelinkbackfilljobs.ensureExists(),
        ),
      );

      expect(await prisma.pagelinkbackfilljobs.count()).toBe(1);
    });
  });

  describe('tryClaim', () => {
    // A fresh document is `idle`, which is deliberately not claimable; a request is what opens it.
    beforeEach(async () => {
      await prisma.pagelinkbackfilljobs.ensureExists();
      await patchJobDocument({ status: 'requested' });
    });

    it('succeeds for the first claimant and rejects a second while the lease is live', async () => {
      const first = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });
      const second = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(await readJob()).toMatchObject({
        claimedBy: 'owner-a',
        status: 'running',
      });
    });

    it('lets exactly one of several simultaneous claimants win', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          prisma.pagelinkbackfilljobs.tryClaim(`owner-${i}`, {
            leaseMs: LEASE_MS,
          }),
        ),
      );

      const winners = results.flatMap((won, i) => (won ? [`owner-${i}`] : []));
      expect(winners).toHaveLength(1);
      expect((await readJob())?.claimedBy).toBe(winners[0]);
    });

    it('lets a new claimant take over once the owner lease has expired', async () => {
      await prisma.pagelinkbackfilljobs.tryClaim('dead-owner', {
        leaseMs: LEASE_MS,
      });
      await expireLease();

      const takenOver = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(takenOver).toBe(true);
      expect((await readJob())?.claimedBy).toBe('owner-b');
    });

    it('lets the claim lapse on its own once the requested lease length has passed', async () => {
      await prisma.pagelinkbackfilljobs.tryClaim('short-lived', {
        leaseMs: 1,
      });

      await vi.waitFor(
        async () => {
          const claimed = await prisma.pagelinkbackfilljobs.tryClaim('next', {
            leaseMs: LEASE_MS,
          });
          expect(claimed).toBe(true);
        },
        { timeout: 2000, interval: 25 },
      );
    });

    it.each([
      { status: 'idle' },
      { status: 'stopped' },
      { status: 'complete' },
      { status: 'failed', retryAt: null },
      { status: 'failed', retryAt: { $date: '2999-01-01T00:00:00Z' } },
    ])('never hands out an unclaimed job in $status with retryAt $retryAt', async (set) => {
      await patchJobDocument(set);

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
      expect(await readJob()).toMatchObject({
        status: set.status,
        claimedBy: null,
      });
    });

    it('never hands out a failed job written before retryAt existed', async () => {
      await prisma.$runCommandRaw({
        update: COLLECTION,
        updates: [
          { q: {}, u: { $set: { status: 'failed' }, $unset: { retryAt: '' } } },
        ],
      });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
    });

    it('hands out a failed job once its retryAt has passed, and clears retryAt', async () => {
      await patchJobDocument({
        status: 'failed',
        failedAttempts: 2,
        retryAt: { $date: '2000-01-01T00:00:00Z' },
      });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(true);
      // The count stays until the retry saves progress, so a retry that fails at once counts on.
      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: 'owner-a',
        failedAttempts: 2,
        retryAt: null,
      });
    });

    it.each([
      'idle',
      'stopped',
      'complete',
    ])('never takes over a %s job, even when its old lease has expired', async (status) => {
      await patchJobDocument({ status, claimedBy: 'old-owner' });
      await expireLease();

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
      expect(await readJob()).toMatchObject({ status, claimedBy: 'old-owner' });
    });

    it.each([
      'requested',
      'running',
    ])('hands out an unclaimed %s job, so a request or an interrupted run can be picked up', async (status) => {
      await patchJobDocument({ status });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(true);
      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: 'owner-a',
      });
    });

    it('does not take a running job from a holder whose lease is still live', async () => {
      await patchJobDocument({
        status: 'running',
        claimedBy: 'live-owner',
        leaseExpiresAt: { $date: '2999-01-01T00:00:00Z' },
      });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: 'live-owner',
      });
    });

    it('clears a stale stopRequested when claiming a requested job', async () => {
      await patchJobDocument({ stopRequested: true });

      await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect((await readJob())?.stopRequested).toBe(false);
    });

    it('keeps a live stopRequested when taking over a running job whose lease expired', async () => {
      await patchJobDocument({
        status: 'running',
        claimedBy: 'dead-owner',
        leaseExpiresAt: { $date: '2000-01-01T00:00:00Z' },
        stopRequested: true,
      });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(true);
      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: 'owner-b',
        stopRequested: true,
      });
    });

    it('keeps a live stopRequested when claiming a failed job whose retry is due', async () => {
      await patchJobDocument({
        status: 'failed',
        claimedBy: null,
        stopRequested: true,
        retryAt: { $date: '2000-01-01T00:00:00Z' },
      });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(true);
      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: 'owner-b',
        stopRequested: true,
      });
    });

    it.each([
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])('rejects leaseMs=%s without touching the job', async (leaseMs) => {
      await expect(
        prisma.pagelinkbackfilljobs.tryClaim('owner-a', { leaseMs }),
      ).rejects.toThrow(/leaseMs/);

      expect(await readJob()).toMatchObject({
        status: 'requested',
        claimedBy: null,
      });
    });

    it('keeps the progress marker across a takeover', async () => {
      const marker = new Types.ObjectId();
      await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });
      await patchJobDocument({
        progressMarker: { $oid: marker.toString() },
        processed: 42,
      });
      await expireLease();

      const takenOver = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(takenOver).toBe(true);
      expect(await readJob()).toMatchObject({
        claimedBy: 'owner-b',
        progressMarker: marker.toString(),
        processed: 42,
      });
    });

    it('does nothing when the job document does not exist', async () => {
      await prisma.pagelinkbackfilljobs.deleteMany({});

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
      expect(await prisma.pagelinkbackfilljobs.count()).toBe(0);
    });
  });

  describe('isRunOutstanding', () => {
    beforeEach(async () => {
      await prisma.pagelinkbackfilljobs.ensureExists();
    });

    it.each([
      { set: { status: 'idle' }, outstanding: false },
      { set: { status: 'requested' }, outstanding: true },
      { set: { status: 'running' }, outstanding: true },
      { set: { status: 'stopped' }, outstanding: false },
      { set: { status: 'complete' }, outstanding: false },
      {
        set: { status: 'failed', retryAt: { $date: '2999-01-01T00:00:00Z' } },
        outstanding: true,
      },
      {
        set: { status: 'failed', retryAt: { $date: '2000-01-01T00:00:00Z' } },
        outstanding: true,
      },
      { set: { status: 'failed', retryAt: null }, outstanding: false },
    ])('is $outstanding for $set', async ({ set, outstanding }) => {
      await patchJobDocument(set);

      expect(await prisma.pagelinkbackfilljobs.isRunOutstanding()).toBe(
        outstanding,
      );
    });

    it('is false when the job document does not exist', async () => {
      await prisma.pagelinkbackfilljobs.deleteMany({});

      expect(await prisma.pagelinkbackfilljobs.isRunOutstanding()).toBe(false);
    });
  });

  describe('writes of the running loop', () => {
    const OWNER = 'owner-a';
    const marker = new Types.ObjectId();
    const progress = {
      progressMarker: marker.toString(),
      processed: 7,
      skippedPages: 2,
    };

    beforeEach(async () => {
      await prisma.pagelinkbackfilljobs.ensureExists();
      await patchJobDocument({ status: 'requested' });
      await prisma.pagelinkbackfilljobs.tryClaim(OWNER, { leaseMs: LEASE_MS });
    });

    // Every write the loop makes, each by a caller that may or may not hold the claim.
    const loopWrites = {
      startRun: (owner: string) =>
        prisma.pagelinkbackfilljobs.startRun(
          owner,
          { runCutoff: null, runTotal: 10 },
          { leaseMs: LEASE_MS },
        ),
      checkpoint: (owner: string) =>
        prisma.pagelinkbackfilljobs.checkpoint(owner, progress, {
          leaseMs: LEASE_MS,
        }),
      finishStopped: (owner: string) =>
        prisma.pagelinkbackfilljobs.finishStopped(owner, progress),
      finishComplete: (owner: string) =>
        prisma.pagelinkbackfilljobs.finishComplete(owner, progress, {
          coverage: 'all',
        }),
      finishFailed: (owner: string) =>
        prisma.pagelinkbackfilljobs.finishFailed(owner, 'boom', {
          retryDelaysMs: RETRY_DELAYS_MS,
        }),
    };
    const refused = (reply: unknown): boolean =>
      reply === false || reply === null;

    describe.each(Object.entries(loopWrites))('%s', (_name, write) => {
      it('is refused for a caller that does not hold the claim, and changes nothing', async () => {
        const before = await readStoredJob();

        const reply = await write('someone-else');

        expect(refused(reply)).toBe(true);
        expect(await readStoredJob()).toEqual(before);
      });

      it('is refused once another instance has taken the claim over', async () => {
        await expireLease();
        await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
          leaseMs: LEASE_MS,
        });
        const before = await readStoredJob();

        const reply = await write(OWNER);

        expect(refused(reply)).toBe(true);
        expect(await readStoredJob()).toEqual(before);
      });

      it('still applies for the holder whose lease has expired while nobody took over', async () => {
        await expireLease();
        const before = await readStoredJob();

        const reply = await write(OWNER);

        expect(refused(reply)).toBe(false);
        expect(await readStoredJob()).not.toEqual(before);
      });

      // An admin Stop that lands on an expired lease ends the run directly; the old owner, still
      // named in claimedBy, must not keep writing to it.
      it('is refused once the job is no longer running', async () => {
        await patchJobDocument({ status: 'stopped' });
        const before = await readStoredJob();

        const reply = await write(OWNER);

        expect(refused(reply)).toBe(true);
        expect(await readStoredJob()).toEqual(before);
      });

      it('is refused when the job document is gone, without recreating it', async () => {
        await prisma.pagelinkbackfilljobs.deleteMany({});

        const reply = await write(OWNER);

        expect(refused(reply)).toBe(true);
        expect(await prisma.pagelinkbackfilljobs.count()).toBe(0);
      });
    });

    it('startRun stores the run cutoff and total and resets the progress', async () => {
      await patchJobDocument({
        progressMarker: { $oid: marker.toString() },
        processed: 99,
        skippedPages: 3,
      });
      const runCutoff = new Date('2026-02-01T00:00:00Z');

      await prisma.pagelinkbackfilljobs.startRun(
        OWNER,
        { runCutoff, runTotal: 42 },
        { leaseMs: LEASE_MS },
      );

      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: OWNER,
        runCutoff,
        runTotal: 42,
        progressMarker: null,
        processed: 0,
        skippedPages: 0,
      });
    });

    it('checkpoint saves the progress and pushes the lease out', async () => {
      await expireLease();

      await prisma.pagelinkbackfilljobs.checkpoint(OWNER, progress, {
        leaseMs: LEASE_MS,
      });

      const job = await readJob();
      expect(job).toMatchObject({
        status: 'running',
        claimedBy: OWNER,
        progressMarker: marker.toString(),
        processed: 7,
        skippedPages: 2,
      });
      expect(job?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
      // The renewed lease is live, so nobody else can claim.
      expect(
        await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
          leaseMs: LEASE_MS,
        }),
      ).toBe(false);
    });

    it.each([
      true,
      false,
    ])('checkpoint reports stopRequested=%s from the document it wrote', async (stopRequested) => {
      await patchJobDocument({ stopRequested });

      const reply = await prisma.pagelinkbackfilljobs.checkpoint(
        OWNER,
        progress,
        { leaseMs: LEASE_MS },
      );

      expect(reply).toEqual({ stopRequested });
    });

    it('finishStopped keeps the progress, releases the claim and clears the stop request', async () => {
      await patchJobDocument({ stopRequested: true });

      await prisma.pagelinkbackfilljobs.finishStopped(OWNER, progress);

      expect(await readJob()).toMatchObject({
        status: 'stopped',
        stopRequested: false,
        claimedBy: null,
        leaseExpiresAt: null,
        progressMarker: marker.toString(),
        processed: 7,
        skippedPages: 2,
      });
      // A stopped job waits for Resume; the poll does not pick it up.
      expect(
        await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
          leaseMs: LEASE_MS,
        }),
      ).toBe(false);
    });

    it('finishComplete records the coverage and completion time and releases the claim', async () => {
      const coveredSince = new Date('2026-02-01T00:00:00Z');
      const before = Date.now();

      await prisma.pagelinkbackfilljobs.finishComplete(OWNER, progress, {
        coverage: 'partial',
        coveredSince,
      });

      const job = await readJob();
      expect(job).toMatchObject({
        status: 'complete',
        coverage: 'partial',
        coveredSince,
        claimedBy: null,
        leaseExpiresAt: null,
        processed: 7,
        skippedPages: 2,
      });
      expect(job?.completedAt?.getTime()).toBeGreaterThanOrEqual(before - 5000);
    });

    /** The DB clock sets `retryAt`; allow for it differing from this process's clock. */
    const CLOCK_SKEW_MS = 5000;
    const expectRetryAfter = async (
      delayMs: number,
      { before, after }: { before: number; after: number },
    ): Promise<void> => {
      const retryAt = (await readJob())?.retryAt?.getTime();
      expect(retryAt).toBeGreaterThanOrEqual(before + delayMs - CLOCK_SKEW_MS);
      expect(retryAt).toBeLessThanOrEqual(after + delayMs + CLOCK_SKEW_MS);
    };

    const failAgain = async (): Promise<void> => {
      await patchJobDocument({ retryAt: { $date: '2000-01-01T00:00:00Z' } });
      expect(
        await prisma.pagelinkbackfilljobs.tryClaim(OWNER, {
          leaseMs: LEASE_MS,
        }),
      ).toBe(true);
      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'boom', {
        retryDelaysMs: RETRY_DELAYS_MS,
      });
    };

    it('finishFailed records the error verbatim, keeps the last checkpoint, and schedules the first retry', async () => {
      const lastError = '$exists is not a field path';
      await prisma.pagelinkbackfilljobs.checkpoint(OWNER, progress, {
        leaseMs: LEASE_MS,
      });
      const before = Date.now();

      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, lastError, {
        retryDelaysMs: RETRY_DELAYS_MS,
      });

      expect(await readJob()).toMatchObject({
        status: 'failed',
        lastError,
        claimedBy: null,
        failedAttempts: 1,
        progressMarker: marker.toString(),
        processed: 7,
      });
      await expectRetryAfter(RETRY_DELAYS_MS[0], { before, after: Date.now() });
    });

    it('finishFailed waits the next delay for each failure in a row, and leaves the job for the admin past the cap', async () => {
      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'boom', {
        retryDelaysMs: RETRY_DELAYS_MS,
      });

      const before = Date.now();
      await failAgain();
      expect(await readJob()).toMatchObject({ failedAttempts: 2 });
      await expectRetryAfter(RETRY_DELAYS_MS[1], { before, after: Date.now() });

      await failAgain();
      expect(await readJob()).toMatchObject({
        status: 'failed',
        failedAttempts: 3,
        retryAt: null,
      });
      expect(await prisma.pagelinkbackfilljobs.isRunOutstanding()).toBe(false);
    });

    it('finishFailed after a retry has saved a checkpoint schedules the first retry again', async () => {
      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'boom', {
        retryDelaysMs: RETRY_DELAYS_MS,
      });
      await patchJobDocument({ retryAt: { $date: '2000-01-01T00:00:00Z' } });
      await prisma.pagelinkbackfilljobs.tryClaim(OWNER, { leaseMs: LEASE_MS });
      await prisma.pagelinkbackfilljobs.checkpoint(OWNER, progress, {
        leaseMs: LEASE_MS,
      });
      const before = Date.now();

      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'later fault', {
        retryDelaysMs: RETRY_DELAYS_MS,
      });

      expect(await readJob()).toMatchObject({ failedAttempts: 1 });
      await expectRetryAfter(RETRY_DELAYS_MS[0], { before, after: Date.now() });
    });

    it('finishFailed schedules no retry while a Stop is pending, and keeps the Stop', async () => {
      await patchJobDocument({ stopRequested: true });

      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'boom', {
        retryDelaysMs: RETRY_DELAYS_MS,
      });

      expect(await readJob()).toMatchObject({
        status: 'failed',
        stopRequested: true,
        failedAttempts: 1,
        retryAt: null,
      });
    });

    it.each([
      [
        'finishStopped',
        () => prisma.pagelinkbackfilljobs.finishStopped(OWNER, progress),
      ],
      [
        'finishComplete',
        () =>
          prisma.pagelinkbackfilljobs.finishComplete(OWNER, progress, {
            coverage: 'all',
          }),
      ],
    ])('%s clears the failures in a row', async (_name, settle) => {
      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'boom', {
        retryDelaysMs: RETRY_DELAYS_MS,
      });
      await patchJobDocument({ retryAt: { $date: '2000-01-01T00:00:00Z' } });
      await prisma.pagelinkbackfilljobs.tryClaim(OWNER, { leaseMs: LEASE_MS });

      await settle();

      expect(await readJob()).toMatchObject({
        failedAttempts: 0,
        retryAt: null,
      });
    });

    it.each([
      [[0]],
      [[60_000, Number.NaN]],
    ])('finishFailed rejects retryDelaysMs=%j without touching the job', async (retryDelaysMs) => {
      await expect(
        prisma.pagelinkbackfilljobs.finishFailed(OWNER, 'boom', {
          retryDelaysMs,
        }),
      ).rejects.toThrow(/retryDelaysMs/);
      expect(await readJob()).toMatchObject({
        status: 'running',
        claimedBy: OWNER,
      });
    });

    it.each([
      0,
      Number.NaN,
    ])('rejects leaseMs=%s for the lease-renewing writes', async (leaseMs) => {
      await expect(
        prisma.pagelinkbackfilljobs.checkpoint(OWNER, progress, { leaseMs }),
      ).rejects.toThrow(/leaseMs/);
      await expect(
        prisma.pagelinkbackfilljobs.startRun(
          OWNER,
          { runCutoff: null, runTotal: 1 },
          { leaseMs },
        ),
      ).rejects.toThrow(/leaseMs/);
    });
  });
});
