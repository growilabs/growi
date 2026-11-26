/**
 * Integration tests for compose-view caching and maintenance operations.
 *
 * These tests require a live docker-compose environment:
 *   - vault-manager service (apps/growi-vault-manager)
 *   - MongoDB instance with vault_user_views and vault_namespace_state collections
 *   - Shared filesystem volume (VAULT_REPO_PATH)
 *
 * This test suite is enabled only when RUN_VAULT_INTEG=true is set.
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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

// Set only when THIS file opened the connection (standalone runs). When the
// in-process integ setup already connected mongoose, we reuse that connection
// and must not disconnect it — the setup owns its lifecycle.
let connectedHere = false;

async function connectMongo(): Promise<void> {
  mongoose = (await import('mongoose')).default as typeof import('mongoose');
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGO_URL);
    connectedHere = true;
  }
}

async function disconnectMongo(): Promise<void> {
  if (mongoose != null && connectedHere) {
    await mongoose.disconnect();
    connectedHere = false;
  }
  mongoose = null;
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
    // biome-ignore lint/performance/noAwaitInLoops: polling loop — must check state sequentially with delay between attempts
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
// Helper: list the files in a namespace's HEAD tree
// ---------------------------------------------------------------------------

function requireRepoPath(): string {
  const repoPath = process.env.VAULT_REPO_PATH;
  if (repoPath == null) {
    throw new Error('VAULT_REPO_PATH is not set by the integ setup');
  }
  return repoPath;
}

async function listNamespaceFiles(namespace: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    [
      '-C',
      requireRepoPath(),
      'ls-tree',
      '-r',
      '--name-only',
      `refs/namespaces/${namespace}/refs/heads/main`,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim().split('\n').filter(Boolean);
}

/** Upserts `count` new pages into the namespace, one instruction at a time. */
async function upsertNewPages(namespace: string, count: number): Promise<void> {
  if (mongoose == null) {
    throw new Error('Mongoose not connected');
  }
  const { ObjectId } = mongoose.mongo;
  for (let i = 0; i < count; i++) {
    const pageId = new ObjectId().toHexString();
    // biome-ignore lint/performance/noAwaitInLoops: instructions are applied one at a time
    await upsertPageAndWait({
      namespace,
      pageId,
      pagePath: `/${namespace}/page-${pageId}`,
      revisionId: new ObjectId().toHexString(),
      bodyText: `# ${pageId}`,
    });
  }
}

/** Inserts a revision document and returns ids for an upsert payload. */
async function newRevision(
  body: string,
): Promise<{ pageId: string; revisionId: string }> {
  if (mongoose?.connection.db == null) {
    throw new Error('Mongoose not connected');
  }
  const { ObjectId } = mongoose.mongo;
  const pageId = new ObjectId();
  const revisionId = new ObjectId();
  await mongoose.connection.db
    .collection('revisions')
    .insertOne({ _id: revisionId, body, pageId });
  return {
    pageId: pageId.toHexString(),
    revisionId: revisionId.toHexString(),
  };
}

/**
 * Inserts an instruction and waits until it is processed or has failed once.
 */
async function insertInstructionAndSettle(
  op: string,
  payload: Record<string, unknown>,
  issuedAt: Date = new Date(),
): Promise<{ id: unknown; processed: boolean; lastError: string | null }> {
  if (mongoose?.connection.db == null) {
    throw new Error('Mongoose not connected');
  }
  const instructions = mongoose.connection.db.collection('vault_instructions');
  const { insertedId } = await instructions.insertOne({
    op,
    payload,
    issuedAt,
    processedAt: null,
    attempts: 0,
    lastError: null,
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: polling loop — must check state sequentially with delay between attempts
    const doc = await instructions.findOne({ _id: insertedId });
    if (doc?.processedAt != null || doc?.lastError != null) {
      return {
        id: insertedId,
        processed: doc.processedAt != null,
        lastError: (doc.lastError as string | null) ?? null,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Instruction ${String(insertedId)} did not settle within 15 s`,
  );
}

/** Inserts an upsert of one new page and waits until it settles. */
async function upsertNewPageAndSettle(
  namespace: string,
): Promise<{ id: unknown; processed: boolean; lastError: string | null }> {
  const ids = await newRevision(`# ${namespace}`);
  return insertInstructionAndSettle('upsert', {
    namespace,
    ...ids,
    pagePath: `/${namespace}/page-${ids.pageId}`,
  });
}

// ---------------------------------------------------------------------------
// Helpers: refs in the bare repository
// ---------------------------------------------------------------------------

const SPARSE_FILTER_REF = 'refs/vault/sparse-filters/exclude-user-pages';

function namespaceRef(namespace: string): string {
  return `refs/namespaces/${namespace}/refs/heads/main`;
}

function packedRefsExist(): boolean {
  return fs.existsSync(path.join(requireRepoPath(), 'packed-refs'));
}

/** Packs every ref the way a gc without gc.packRefs=false does. */
async function packAllRefs(): Promise<void> {
  await execFileAsync('git', [
    '-C',
    requireRepoPath(),
    'pack-refs',
    '--all',
    '--prune',
  ]);
}

/** Resolves a ref the way git does (loose file first, then packed-refs). */
async function resolveRef(ref: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      requireRepoPath(),
      'rev-parse',
      '--verify',
      '--quiet',
      ref,
    ]);
    return stdout.trim();
  } catch {
    return null;
  }
}

function findInstruction(id: unknown): Promise<Record<string, unknown> | null> {
  if (mongoose?.connection.db == null) {
    throw new Error('Mongoose not connected');
  }
  return mongoose.connection.db
    .collection('vault_instructions')
    .findOne({ _id: id });
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

(process.env.RUN_VAULT_INTEG === 'true' ? describe : describe.skip)(
  'Integration: compose-view caching and maintenance',
  () => {
    let tmpDir: string;

    beforeAll(async () => {
      // Warn if required environment variables are missing so CI operators can
      // diagnose why these tests are being skipped.
      const missing = [
        'VAULT_MANAGER_BASE_URL',
        'VAULT_MANAGER_INTERNAL_SECRET',
        'MONGO_URL',
      ].filter((v) => !process.env[v]);
      if (missing.length > 0) {
        process.stderr.write(
          `[SKIP] Missing env vars: ${missing.join(', ')}. Set RUN_VAULT_INTEG=true and required vars to run.\n`,
        );
      }

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

    it('calling compose-view twice with the same sourceVersions returns the same commitOid (cache hit)', {
      timeout: 30_000,
    }, async () => {
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

    it('compose-view returns a fresh commitOid after the namespace receives a new commit (cache miss)', {
      timeout: 30_000,
    }, async () => {
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

    // The scheduler tick interval is configurable via VAULT_MAINTENANCE_TICK_MS
    // (default 5 minutes in production). In CI the test harness sets a short
    // value (e.g. 5 s) so the squash trigger fires quickly after the
    // namespace's commit count exceeds the threshold.
    const tickIntervalMs = Number.parseInt(
      process.env.VAULT_MAINTENANCE_TICK_MS ?? `${5 * 60 * 1000}`,
      10,
    );
    // Allow up to 12 ticks of waiting for the squash to fire, capped at 8 min.
    const squashWaitMs = Math.min(tickIntervalMs * 12, 8 * 60 * 1000);
    // Drain budget: 1001 sequential upserts take ~50 ms each on healthy CI,
    // but allow generous slack so a slow runner does not flake.
    const drainWaitMs = 3 * 60 * 1000;
    const squashTestTimeoutMs = drainWaitMs + squashWaitMs + 30_000;

    it('namespace history is squashed to depth=1 after exceeding VAULT_SQUASH_COMMIT_THRESHOLD commits', {
      timeout: squashTestTimeoutMs,
    }, async () => {
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

      // Wait for all instructions to be processed within the drain budget.
      const drainDeadline = Date.now() + drainWaitMs;
      while (Date.now() < drainDeadline) {
        // biome-ignore lint/performance/noAwaitInLoops: polling loop — must check state sequentially with delay between attempts
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

      // Wait for the next scheduler tick to perform the squash within the
      // computed squash budget.
      const squashDeadline = Date.now() + squashWaitMs;
      let squashed = false;

      while (Date.now() < squashDeadline) {
        // biome-ignore lint/performance/noAwaitInLoops: polling loop — must check state sequentially with delay between attempts
        const stateDoc = await db
          .collection('vault_namespace_state')
          .findOne({ namespace: squashNs });

        if (stateDoc != null && stateDoc.version === 1) {
          squashed = true;
          break;
        }

        // Poll every ~tick/2 so we notice the squash promptly without burning
        // CPU; clamp between 500 ms and 5 s for sane behavior.
        const pollMs = Math.min(Math.max(tickIntervalMs / 2, 500), 5_000);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      // After squash, version must be reset to 1.
      expect(squashed).toBe(true);

      const stateAfterSquash = await db
        .collection('vault_namespace_state')
        .findOne({ namespace: squashNs });

      expect(stateAfterSquash?.version).toBe(1);
      expect(stateAfterSquash?.commitOid).toMatch(/^[0-9a-f]{40}$/);

      // The namespace HEAD is a single root commit that still holds every page.
      const { stdout: depth } = await execFileAsync('git', [
        '-C',
        requireRepoPath(),
        'rev-list',
        '--count',
        `refs/namespaces/${squashNs}/refs/heads/main`,
      ]);
      expect(Number(depth.trim())).toBe(1);
      expect(await listNamespaceFiles(squashNs)).toHaveLength(COMMIT_COUNT);
    });

    // -------------------------------------------------------------------------
    // Test 3: gc / clone concurrency — clone must not be corrupted by gc
    // -------------------------------------------------------------------------

    it('a git clone started concurrently with gc completes successfully without corruption', {
      timeout: 180_000,
    }, async () => {
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
        // biome-ignore lint/performance/noAwaitInLoops: pages must be inserted sequentially to avoid concurrent writes to the same bare repo
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

    // -------------------------------------------------------------------------
    // Test 4: namespace pages survive gc
    // -------------------------------------------------------------------------

    it('keeps every page of a namespace when a page is written after gc', {
      timeout: 120_000,
    }, async () => {
      const ns = 'integ-pages-after-gc-ns';
      await upsertNewPages(ns, 3);

      await triggerGcAndWait();
      expect(packedRefsExist()).toBe(false);
      await upsertNewPages(ns, 1);

      expect(await listNamespaceFiles(ns)).toHaveLength(4);
    });

    // The tests below run last: every reset-all they issue wipes every namespace.
    async function rebuildVault(issuedAt?: Date): Promise<void> {
      const rebuild = await insertInstructionAndSettle(
        'reset-all',
        {},
        issuedAt,
      );
      expect(rebuild.lastError).toBeNull();
    }

    it('a rebuild (reset-all) wipes every namespace ref, its state and the composed views', {
      timeout: 120_000,
    }, async () => {
      const ns = 'integ-rebuild-ns';
      await upsertNewPages(ns, 2);
      await callComposeView('cafebabedeadbeef00000006', [ns]);

      await rebuildVault();

      const db = mongoose?.connection.db;
      expect(await resolveRef(namespaceRef(ns))).toBeNull();
      expect(
        await db?.collection('vault_namespace_state').countDocuments(),
      ).toBe(0);
      expect(await db?.collection('vault_user_views').countDocuments()).toBe(0);

      await upsertNewPages(ns, 1);
      expect(await listNamespaceFiles(ns)).toHaveLength(1);
    });

    it('a rebuild also wipes a namespace ref the state has no record of, and the view refs', {
      timeout: 120_000,
    }, async () => {
      const ns = 'integ-rebuild-orphan-ns';
      await upsertNewPages(ns, 2);
      const view = await callComposeView('cafebabedeadbeef00000007', [ns]);
      // The state of a namespace whose instruction failed between the ref
      // update and the state write.
      const db = mongoose?.connection.db;
      await db
        ?.collection('vault_namespace_state')
        .deleteOne({ namespace: ns });
      expect(await resolveRef(namespaceRef(view.viewRef))).not.toBeNull();

      await rebuildVault();

      expect(await resolveRef(namespaceRef(ns))).toBeNull();
      expect(await resolveRef(namespaceRef(view.viewRef))).toBeNull();
      expect(await resolveRef(SPARSE_FILTER_REF)).not.toBeNull();

      await upsertNewPages(ns, 1);
      expect(await listNamespaceFiles(ns)).toHaveLength(1);
    });

    describe('while refs are packed', () => {
      afterEach(async () => {
        if (packedRefsExist()) {
          await rebuildVault();
        }
      });

      it('refuses writes until a rebuild (reset-all) clears the packed refs', {
        timeout: 120_000,
      }, async () => {
        const ns = 'integ-refuse-packed-ref-ns';
        await upsertNewPages(ns, 3);
        await packAllRefs();

        const refused = await upsertNewPageAndSettle(ns);
        expect(refused.lastError).toMatch(/Rebuild Vault/);
        expect(await listNamespaceFiles(ns)).toHaveLength(3);

        await rebuildVault();
        expect(packedRefsExist()).toBe(false);

        // The refused write is superseded by the rebuild, so no later drain
        // replays it on top of the rebuilt namespace.
        expect((await findInstruction(refused.id))?.processedAt).not.toBeNull();

        await upsertNewPages(ns, 1);
        expect(await listNamespaceFiles(ns)).toHaveLength(1);
      });

      it('refuses a write to a namespace whose ref is also loose, or that has no ref yet', {
        timeout: 120_000,
      }, async () => {
        const looseNs = 'integ-packed-and-loose-ns';
        const newNs = 'integ-packed-new-ns';
        await upsertNewPages(looseNs, 3);
        const head = await resolveRef(namespaceRef(looseNs));
        const filterOid = await resolveRef(SPARSE_FILTER_REF);
        await packAllRefs();
        const looseRefFile = path.join(
          requireRepoPath(),
          namespaceRef(looseNs),
        );
        await fs.promises.mkdir(path.dirname(looseRefFile), {
          recursive: true,
        });
        await fs.promises.writeFile(looseRefFile, `${head}\n`);

        const refusedLoose = await upsertNewPageAndSettle(looseNs);
        expect(refusedLoose.lastError).toMatch(/Rebuild Vault/);
        expect(await listNamespaceFiles(looseNs)).toHaveLength(3);

        const refusedNew = await upsertNewPageAndSettle(newNs);
        expect(refusedNew.lastError).toMatch(/Rebuild Vault/);
        expect(await resolveRef(namespaceRef(newNs))).toBeNull();

        await rebuildVault();
        expect(packedRefsExist()).toBe(false);
        expect(await resolveRef(namespaceRef(looseNs))).toBeNull();
        expect(await resolveRef(SPARSE_FILTER_REF)).toBe(filterOid);

        await upsertNewPages(looseNs, 1);
        expect(await listNamespaceFiles(looseNs)).toHaveLength(1);
      });

      it('refuses compose-view until a rebuild, even for a view composed before', {
        timeout: 120_000,
      }, async () => {
        const ns = 'integ-packed-compose-ns';
        const cachedUserId = 'cafebabedeadbeef00000004';
        const newUserId = 'cafebabedeadbeef00000005';
        await upsertNewPages(ns, 1);
        await callComposeView(cachedUserId, [ns]);
        await packAllRefs();

        await expect(callComposeView(cachedUserId, [ns])).rejects.toThrow(
          /compose-view returned 500/,
        );
        await expect(callComposeView(newUserId, [ns])).rejects.toThrow(
          /compose-view returned 500/,
        );

        await rebuildVault();
        const { commitOid } = await callComposeView(cachedUserId, [ns]);
        expect(commitOid).toMatch(/^[0-9a-f]{40}$/);
      });

      it('a rebuild supersedes an instruction that was given up on, but not one issued after the rebuild', {
        timeout: 120_000,
      }, async () => {
        const ns = 'integ-packed-supersede-ns';
        await upsertNewPages(ns, 1);
        await packAllRefs();

        const givenUp = await upsertNewPageAndSettle(ns);
        await mongoose?.connection.db
          ?.collection('vault_instructions')
          .updateOne({ _id: givenUp.id }, { $set: { attempts: 7 } });
        const rebuildIssuedAt = new Date();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const issuedLater = await upsertNewPageAndSettle(ns);
        expect(issuedLater.lastError).toMatch(/Rebuild Vault/);

        await rebuildVault(rebuildIssuedAt);

        expect((await findInstruction(givenUp.id))?.processedAt).not.toBeNull();
        expect((await findInstruction(issuedLater.id))?.processedAt).toBeNull();
      });

      it('gc leaves packed-refs and the refs in it as they are', {
        timeout: 120_000,
      }, async () => {
        const ns = 'integ-packed-gc-ns';
        await upsertNewPages(ns, 2);
        const head = await resolveRef(namespaceRef(ns));
        await packAllRefs();

        await triggerGcAndWait();

        expect(packedRefsExist()).toBe(true);
        expect(await resolveRef(namespaceRef(ns))).toBe(head);
        expect(await listNamespaceFiles(ns)).toHaveLength(2);
      });
    });
  },
);
