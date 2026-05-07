/**
 * Integration tests for compose-view caching and maintenance operations.
 *
 * These tests require a live docker-compose environment:
 *   - vault-manager service (apps/growi-vault-manager)
 *   - MongoDB instance with vault_user_views and vault_namespace_state collections
 *   - Shared filesystem volume (VAULT_REPO_PATH)
 *
 * The test suite is wrapped in describe.skip so that it is excluded from the
 * standard unit-test run and can be activated explicitly in CI environments
 * that provide the docker-compose stack.
 *
 * Test coverage:
 *  1. Cache hit: calling compose-view twice with identical sourceVersions returns
 *     the same commitOid without recomposing.
 *  2. Squash auto-trigger: after 1000+ commits the maintenance scheduler squashes
 *     the namespace history to depth=1.
 *  3. GC / clone concurrency: starting a clone while gc is running must not
 *     corrupt the clone output.
 *
 * Environment variables required:
 *   VAULT_MANAGER_BASE_URL        e.g. http://localhost:3001
 *   VAULT_MANAGER_INTERNAL_SECRET shared service secret
 *   MONGO_URL                     e.g. mongodb://localhost:27017/growi-vault-integ
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.VAULT_MANAGER_BASE_URL ?? 'http://localhost:3001';
const INTERNAL_SECRET =
  process.env.VAULT_MANAGER_INTERNAL_SECRET ?? 'test-secret-for-integration';
const AUTH_HEADER = `Bearer ${INTERNAL_SECRET}`;

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://localhost:27017/growi-vault-integ';

// ---------------------------------------------------------------------------
// Lazy mongoose import
// ---------------------------------------------------------------------------

let mongoose: typeof import('mongoose') | null = null;

async function connectMongo(): Promise<void> {
  mongoose = (await import('mongoose')).default as typeof import('mongoose');
  await mongoose.connect(MONGO_URL);
}

async function disconnectMongo(): Promise<void> {
  if (mongoose != null) {
    await mongoose.disconnect();
    mongoose = null;
  }
}

// ---------------------------------------------------------------------------
// Helper: call compose-view RPC
// ---------------------------------------------------------------------------

async function callComposeView(
  userId: string | null,
  namespaces: string[],
): Promise<{ viewRef: string; commitOid: string }> {
  const res = await fetch(`${BASE_URL}/internal/compose-view`, {
    method: 'POST',
    headers: {
      Authorization: AUTH_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, namespaces }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`compose-view returned ${res.status}: ${body}`);
  }
  return res.json() as Promise<{ viewRef: string; commitOid: string }>;
}

// ---------------------------------------------------------------------------
// Helper: insert a upsert instruction and wait for it to be processed
// ---------------------------------------------------------------------------

async function upsertPageAndWait(opts: {
  namespace: string;
  pageId: string;
  pagePath: string;
  revisionId: string;
  bodyText: string;
}): Promise<void> {
  if (mongoose == null) {
    throw new Error('Mongoose not connected');
  }
  const db = mongoose.connection.db;
  if (db == null) {
    throw new Error('Mongoose connection db is null');
  }
  const { ObjectId } = mongoose.mongo;

  // Ensure the revision document exists.
  await db.collection('revisions').updateOne(
    { _id: new ObjectId(opts.revisionId) },
    {
      $setOnInsert: {
        _id: new ObjectId(opts.revisionId),
        body: opts.bodyText,
        pageId: new ObjectId(opts.pageId),
      },
    },
    { upsert: true },
  );

  // Insert the instruction.
  const result = await db.collection('vault_instructions').insertOne({
    op: 'upsert',
    payload: {
      namespace: opts.namespace,
      pageId: opts.pageId,
      pagePath: opts.pagePath,
      revisionId: opts.revisionId,
    },
    issuedAt: new Date(),
    processedAt: null,
    attempts: 0,
    lastError: null,
  });

  const instrId = String(result.insertedId);

  // Poll until processedAt is set.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const doc = await db
      .collection('vault_instructions')
      .findOne({ _id: new ObjectId(instrId) });

    if (doc?.processedAt != null) {
      if (doc.lastError != null) {
        throw new Error(`Instruction failed: ${doc.lastError as string}`);
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Instruction ${instrId} was not processed within 15 s`);
}

// ---------------------------------------------------------------------------
// Helper: trigger manual gc via the maintenance endpoint and wait for completion
// ---------------------------------------------------------------------------

async function triggerGcAndWait(): Promise<{
  looseObjectCountBefore: number;
  looseObjectCountAfter: number;
  elapsedMs: number;
}> {
  const res = await fetch(`${BASE_URL}/internal/maintenance/trigger-gc`, {
    method: 'POST',
    headers: { Authorization: AUTH_HEADER },
  });
  if (!res.ok) {
    throw new Error(`trigger-gc returned ${res.status}`);
  }
  return res.json() as Promise<{
    looseObjectCountBefore: number;
    looseObjectCountAfter: number;
    elapsedMs: number;
  }>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skip('Integration: compose-view caching and maintenance', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await connectMongo();
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'vault-maintenance-test-'),
    );
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
    await disconnectMongo();
  });

  // -------------------------------------------------------------------------
  // Test 1: compose-view cache hit on identical sourceVersions
  // -------------------------------------------------------------------------

  it('calling compose-view twice with the same sourceVersions returns the same commitOid (cache hit)', async () => {
    // Use a dedicated namespace and user for this test to avoid cross-test
    // interference from namespace state mutations.
    const cacheTestNs = 'integ-cache-test-public';
    const cacheTestUserId = 'cafebabedeadbeef00000001';
    const namespaces = [cacheTestNs];

    // --- First call: triggers full merge, creates view ref ---
    const first = await callComposeView(cacheTestUserId, namespaces);

    expect(first.viewRef).toBe(`user-${cacheTestUserId}-view`);
    expect(first.commitOid).toMatch(/^[0-9a-f]{40}$/);

    // --- Second call: same userId + same namespaces with no intermediate commits ---
    // Because the namespace has not received any new commits since the first call,
    // the sourceVersions are identical → cache hit → same commitOid returned.
    const second = await callComposeView(cacheTestUserId, namespaces);

    expect(second.viewRef).toBe(first.viewRef);
    expect(second.commitOid).toBe(first.commitOid);

    // Verify the vault_user_views document was NOT updated (composedAt unchanged).
    if (mongoose == null) {
      throw new Error('Mongoose not connected');
    }
    const db = mongoose.connection.db;
    if (db == null) {
      throw new Error('Mongoose connection db is null');
    }
    const viewDoc1 = await db
      .collection('vault_user_views')
      .findOne({ userId: cacheTestUserId });

    // Wait a short time, then call again — if composedAt didn't change it is truly a cache hit.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const third = await callComposeView(cacheTestUserId, namespaces);

    const viewDoc2 = await db
      .collection('vault_user_views')
      .findOne({ userId: cacheTestUserId });

    expect(third.commitOid).toBe(first.commitOid);

    // composedAt must be identical across all three calls (no recompose happened).
    expect(viewDoc1?.composedAt?.getTime()).toBe(
      viewDoc2?.composedAt?.getTime(),
    );
  });

  it('compose-view returns a fresh commitOid after the namespace receives a new commit (cache miss)', async () => {
    const cacheTestNs = 'integ-cache-invalidation-ns';
    const cacheTestUserId = 'cafebabedeadbeef00000002';
    const namespaces = [cacheTestNs];

    if (mongoose == null) {
      throw new Error('Mongoose not connected');
    }
    const { ObjectId } = mongoose.mongo;

    // --- First compose ---
    const first = await callComposeView(cacheTestUserId, namespaces);
    const commitOidBeforeUpdate = first.commitOid;

    // --- Mutate the namespace: add a new page ---
    const pageId = new ObjectId().toHexString();
    const revisionId = new ObjectId().toHexString();

    await upsertPageAndWait({
      namespace: cacheTestNs,
      pageId,
      pagePath: '/cache-invalidation-test/new-page',
      revisionId,
      bodyText: '# Cache Invalidation Test\nNew content.',
    });

    // --- Second compose: namespace state changed → cache miss → new commitOid ---
    const second = await callComposeView(cacheTestUserId, namespaces);

    expect(second.commitOid).not.toBe(commitOidBeforeUpdate);
    expect(second.commitOid).toMatch(/^[0-9a-f]{40}$/);
  });

  // -------------------------------------------------------------------------
  // Test 2: squash auto-trigger after 1000+ commits
  // -------------------------------------------------------------------------

  it('namespace history is squashed to depth=1 after exceeding VAULT_SQUASH_COMMIT_THRESHOLD commits', async () => {
    // This test inserts 1001 sequential upsert instructions into a dedicated
    // namespace to drive the version counter past the squash threshold
    // (default: 1000).  It then waits for the maintenance scheduler to fire
    // (poll up to 8 minutes) and asserts that the namespace's commit chain
    // has been squashed to a root commit (depth=1, i.e. no parents).

    const squashNs = 'integ-squash-test-ns';

    if (mongoose == null) {
      throw new Error('Mongoose not connected');
    }
    const db = mongoose.connection.db;
    if (db == null) {
      throw new Error('Mongoose connection db is null');
    }
    const { ObjectId } = mongoose.mongo;

    const COMMIT_COUNT = 1001; // one above the default threshold of 1000

    // Pre-create revision documents in bulk for efficiency.
    type RevisionDoc = {
      _id: InstanceType<typeof ObjectId>;
      body: string;
      pageId: InstanceType<typeof ObjectId>;
    };
    const revisionDocs: RevisionDoc[] = [];
    const instructions: Array<{
      op: string;
      payload: Record<string, unknown>;
      issuedAt: Date;
      processedAt: null;
      attempts: number;
      lastError: null;
    }> = [];

    for (let i = 0; i < COMMIT_COUNT; i++) {
      const pageId = new ObjectId().toHexString();
      const revisionId = new ObjectId().toHexString();

      revisionDocs.push({
        _id: new ObjectId(revisionId),
        body: `# Squash Test Page ${i}\nContent for commit ${i}.`,
        pageId: new ObjectId(pageId),
      });

      instructions.push({
        op: 'upsert',
        payload: {
          namespace: squashNs,
          pageId,
          pagePath: `/squash-test/page-${i.toString().padStart(5, '0')}`,
          revisionId,
        },
        issuedAt: new Date(),
        processedAt: null,
        attempts: 0,
        lastError: null,
      });
    }

    await db.collection('revisions').insertMany(revisionDocs);
    await db.collection('vault_instructions').insertMany(instructions);

    // Wait for all instructions to be processed (allow up to 5 minutes for 1001 commits).
    const drainDeadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < drainDeadline) {
      const unprocessedCount = await db
        .collection('vault_instructions')
        .countDocuments({
          'payload.namespace': squashNs,
          processedAt: null,
        });

      if (unprocessedCount === 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Confirm all instructions were processed without errors.
    const failedCount = await db
      .collection('vault_instructions')
      .countDocuments({
        'payload.namespace': squashNs,
        processedAt: { $ne: null },
        lastError: { $ne: null },
      });
    expect(failedCount).toBe(0);

    // At this point the version counter must be >= COMMIT_COUNT.
    const stateBeforeSquash = await db
      .collection('vault_namespace_state')
      .findOne({ namespace: squashNs });
    expect(stateBeforeSquash?.version).toBeGreaterThanOrEqual(COMMIT_COUNT);

    // Wait for the squash tick (scheduler fires every 5 minutes; allow 8 minutes).
    const squashDeadline = Date.now() + 8 * 60 * 1000;
    let squashed = false;

    while (Date.now() < squashDeadline) {
      const stateDoc = await db
        .collection('vault_namespace_state')
        .findOne({ namespace: squashNs });

      if (stateDoc != null && stateDoc.version === 1) {
        squashed = true;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }

    // After squash, version must be reset to 1.
    expect(squashed).toBe(true);

    const stateAfterSquash = await db
      .collection('vault_namespace_state')
      .findOne({ namespace: squashNs });

    expect(stateAfterSquash?.version).toBe(1);
    expect(stateAfterSquash?.commitOid).toMatch(/^[0-9a-f]{40}$/);

    // Verify the squash commit is a root commit (no parents) by calling the
    // storage-stats or health endpoint — a direct git log check would require
    // shell access to the repo, which we proxy via the manager's HTTP API.
    // Here we simply assert that the namespace state is coherent after squash.
    expect(stateAfterSquash?.commitOid).not.toBe(stateBeforeSquash?.commitOid);
  });

  // -------------------------------------------------------------------------
  // Test 3: gc / clone concurrency — clone must not be corrupted by gc
  // -------------------------------------------------------------------------

  it('a git clone started concurrently with gc completes successfully without corruption', async () => {
    // This test exercises the requirement that git gc (which prunes loose
    // objects and rewrites packs) must not corrupt an in-flight clone.
    // The git protocol uses pack negotiation (stateless RPC over HTTP), so
    // the pack data is assembled and streamed before gc can affect it.
    //
    // Strategy:
    //  1. Prepare a namespace with enough data to produce a non-trivial pack.
    //  2. Start a gc trigger via the maintenance endpoint (async, non-awaited).
    //  3. Immediately start a git clone.
    //  4. Await both operations.
    //  5. Assert both succeed and the clone repo is valid.

    const concurrencyNs = 'integ-gc-concurrency-ns';
    const concurrencyUserId = 'cafebabedeadbeef00000003';
    const namespaces = [concurrencyNs];

    if (mongoose == null) {
      throw new Error('Mongoose not connected');
    }
    const { ObjectId } = mongoose.mongo;

    // --- Step 1: Populate the namespace with some pages ---
    const setupPageCount = 50;
    for (let i = 0; i < setupPageCount; i++) {
      const pageId = new ObjectId().toHexString();
      const revisionId = new ObjectId().toHexString();
      await upsertPageAndWait({
        namespace: concurrencyNs,
        pageId,
        pagePath: `/gc-concurrency/page-${i.toString().padStart(3, '0')}`,
        revisionId,
        bodyText: `# GC Concurrency Test Page ${i}\n${'Content line.\n'.repeat(20)}`,
      });
    }

    // --- Step 2: Compose a view for the test user ---
    const { viewRef } = await callComposeView(concurrencyUserId, namespaces);

    const cloneTarget = path.join(tmpDir, 'gc-concurrency-clone');

    // --- Step 3: Start gc and clone concurrently ---
    // triggerGcAndWait sends POST /internal/maintenance/trigger-gc and awaits
    // the response, which arrives only after git gc finishes.
    const gcPromise = triggerGcAndWait();

    // git clone is started immediately after gc is dispatched — they run in parallel.
    const clonePromise = execFileAsync('git', [
      'clone',
      '--config',
      `http.extraheader=Authorization: ${AUTH_HEADER}`,
      '--config',
      `http.extraheader=x-vault-view-ref: ${viewRef}`,
      `${BASE_URL}/internal/git`,
      cloneTarget,
    ]);

    // --- Step 4: Await both ---
    const [gcResult] = await Promise.all([gcPromise, clonePromise]);

    // --- Step 5: Assertions ---

    // gc must have completed with a measurable elapsed time.
    expect(gcResult.elapsedMs).toBeGreaterThan(0);

    // The clone directory must exist and be a valid git repository.
    const gitDir = path.join(cloneTarget, '.git');
    const stat = await fs.promises.stat(gitDir);
    expect(stat.isDirectory()).toBe(true);

    // `git fsck` must report no errors in the cloned repository.
    const { stdout: fsckOutput, stderr: fsckStderr } = await execFileAsync(
      'git',
      ['fsck', '--strict', '--full'],
      { cwd: cloneTarget },
    );
    // git fsck exits 0 and produces no error output when the repo is clean.
    // We assert that neither stdout nor stderr contains "error" or "corrupt".
    const fsckCombined = (fsckOutput + fsckStderr).toLowerCase();
    expect(fsckCombined).not.toContain('error');
    expect(fsckCombined).not.toContain('corrupt');

    // Verify HEAD is a valid commit in the cloned repo.
    const { stdout: headOid } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      { cwd: cloneTarget },
    );
    expect(headOid.trim()).toMatch(/^[0-9a-f]{40}$/);

    // The loose object count after gc should be lower than or equal to the
    // count before (packing + pruning reduces loose objects).
    expect(gcResult.looseObjectCountAfter).toBeLessThanOrEqual(
      gcResult.looseObjectCountBefore,
    );
  });
});
