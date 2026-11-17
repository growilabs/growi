import { Types } from 'mongoose';

import type { Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

import { throwOnWriteErrors } from './throw-on-write-errors';

const COLLECTION = 'pagelinkbackfilljobs';
const LEASE_MS = 60_000;

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

// Infra reads this document straight from MongoDB, so the stored field names are the contract.
// A Prisma read cannot show them: it reports a nullable field that was never written as null.
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
      'idle',
      'stopped',
      'complete',
    ])('never hands out an unclaimed %s job', async (status) => {
      await patchJobDocument({ status });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
      expect(await readJob()).toMatchObject({ status, claimedBy: null });
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
      'failed',
    ])('hands out an unclaimed %s job, so a request, an interrupted run or a failed run can be picked up', async (status) => {
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

    it.each([
      'running',
      'failed',
    ])('does not take a %s job from a holder whose lease is still live', async (status) => {
      await patchJobDocument({
        status,
        claimedBy: 'live-owner',
        leaseExpiresAt: { $date: '2999-01-01T00:00:00Z' },
      });

      const claimed = await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
        leaseMs: LEASE_MS,
      });

      expect(claimed).toBe(false);
      expect(await readJob()).toMatchObject({
        status,
        claimedBy: 'live-owner',
      });
    });

    it('clears a stale stopRequested when claiming', async () => {
      await patchJobDocument({ stopRequested: true });

      await prisma.pagelinkbackfilljobs.tryClaim('owner-a', {
        leaseMs: LEASE_MS,
      });

      expect((await readJob())?.stopRequested).toBe(false);
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
          coveredSince: null,
        }),
      finishFailed: (owner: string) =>
        prisma.pagelinkbackfilljobs.finishFailed(owner, 'boom'),
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

        const reply = await write(OWNER);

        expect(refused(reply)).toBe(false);
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

    it('finishFailed records the error verbatim and leaves the job, with its last checkpoint, for the next claim', async () => {
      const lastError = '$exists is not a field path';
      await prisma.pagelinkbackfilljobs.checkpoint(OWNER, progress, {
        leaseMs: LEASE_MS,
      });

      await prisma.pagelinkbackfilljobs.finishFailed(OWNER, lastError);

      expect(await readJob()).toMatchObject({
        status: 'failed',
        lastError,
        claimedBy: null,
        progressMarker: marker.toString(),
      });
      expect(
        await prisma.pagelinkbackfilljobs.tryClaim('owner-b', {
          leaseMs: LEASE_MS,
        }),
      ).toBe(true);
      expect(await readJob()).toMatchObject({
        status: 'running',
        progressMarker: marker.toString(),
        processed: 7,
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
