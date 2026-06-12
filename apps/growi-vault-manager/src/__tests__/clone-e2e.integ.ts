/**
 * E2E integration tests for git clone flow through vault-manager.
 *
 * These tests require a live docker-compose environment:
 *   - vault-manager service (apps/growi-vault-manager)
 *   - MongoDB instance
 *   - Shared filesystem volume (VAULT_REPO_PATH)
 *
 * This test suite is enabled only when RUN_VAULT_INTEG=true is set.
 * Set the required environment variables and execute:
 *   pnpm vitest run clone-e2e.integ
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration (resolved from environment variables at suite start)
// ---------------------------------------------------------------------------

/**
 * Base URL of the vault-manager service.
 * Example: http://localhost:3001
 */
const BASE_URL = process.env.VAULT_MANAGER_BASE_URL ?? 'http://localhost:3001';

/**
 * Shared secret for service-to-service authentication.
 * Must match VAULT_MANAGER_INTERNAL_SECRET configured in docker-compose.
 */
const INTERNAL_SECRET =
  process.env.VAULT_MANAGER_INTERNAL_SECRET ?? 'test-secret-for-integration';

/** Authorization header value for authenticated requests. */
const AUTH_HEADER = `Bearer ${INTERNAL_SECRET}`;

/** Test user ID (arbitrary ObjectId-like string). */
const TEST_USER_ID = 'aabbccddeeff001122334455';

/** Namespaces the test user has access to. */
const TEST_NAMESPACES = ['public'];

/**
 * MongoDB connection URL for integration test seeding.
 * Must match the MongoDB instance accessible by the vault-manager service.
 */
const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://localhost:27017/growi-vault-integ';

// ---------------------------------------------------------------------------
// Lazy mongoose import (only connected when normalization tests run)
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
// Helper: insert a vault upsert instruction and poll until processed
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

  // Insert the upsert instruction.
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

  // Poll until processedAt is set (up to 15 s).
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

    // biome-ignore lint/performance/noAwaitInLoops: polling delay between instruction-completion checks
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Instruction ${instrId} was not processed within 15 s`);
}

// ---------------------------------------------------------------------------
// Helper: collect all relative file paths in a cloned directory (recursive)
// ---------------------------------------------------------------------------

async function listFilesRecursive(dir: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(current: string, relative: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      // Skip .git directory.
      if (entry.name === '.git') continue;
      const entryRelative =
        relative !== '' ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // biome-ignore lint/performance/noAwaitInLoops: recursive directory walk — must be sequential to build path list correctly
        await walk(path.join(current, entry.name), entryRelative);
      } else {
        result.push(entryRelative);
      }
    }
  }

  await walk(dir, '');
  return result;
}

// ---------------------------------------------------------------------------
// Helper: compute the expected __<hash8> suffix for a pre-suffix filePath
// ---------------------------------------------------------------------------

function computeExpectedHash8(preSuffixFilePath: string): string {
  return createHash('sha1').update(preSuffixFilePath).digest('hex').slice(0, 8);
}

// ---------------------------------------------------------------------------
// Helper: send a raw HTTP request and return { status, body, headers }
// ---------------------------------------------------------------------------

async function httpRequest(opts: {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; body: unknown; headers: Headers }> {
  const init: RequestInit = {
    method: opts.method,
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  };
  if (opts.body != null) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(opts.url, init);
  let body: unknown;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  return { status: res.status, body, headers: res.headers };
}

// ---------------------------------------------------------------------------
// Helper: call compose-view RPC and return { viewRef, commitOid }
// ---------------------------------------------------------------------------

async function callComposeView(
  userId: string,
  namespaces: string[],
): Promise<{ viewRef: string; commitOid: string }> {
  const res = await httpRequest({
    url: `${BASE_URL}/internal/compose-view`,
    method: 'POST',
    headers: { Authorization: AUTH_HEADER },
    body: { userId, namespaces },
  });
  expect(res.status).toBe(200);
  return res.body as { viewRef: string; commitOid: string };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

(process.env.RUN_VAULT_INTEG === 'true' ? describe : describe.skip)(
  'E2E: git clone flow through vault-manager',
  () => {
    let tmpCloneDir: string;

    beforeAll(async () => {
      // Warn if required environment variables are missing so CI operators can
      // diagnose why these tests are being skipped.
      const missing = [
        'VAULT_MANAGER_BASE_URL',
        'VAULT_MANAGER_INTERNAL_SECRET',
      ].filter((v) => !process.env[v]);
      if (missing.length > 0) {
        process.stderr.write(
          `[SKIP] Missing env vars: ${missing.join(', ')}. Set RUN_VAULT_INTEG=true and required vars to run.\n`,
        );
      }

      // Create a temporary directory for git clone output.
      tmpCloneDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'vault-clone-test-'),
      );
    });

    afterAll(async () => {
      // Clean up the temporary clone directory after all tests.
      await fs.promises.rm(tmpCloneDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // Test 1: /health returns 200 without authentication
    // -------------------------------------------------------------------------

    it('GET /health returns 200 without a PAT or Authorization header', async () => {
      // The /health endpoint must be reachable by Kubernetes liveness probes,
      // which do not carry any credentials.
      const res = await httpRequest({
        url: `${BASE_URL}/health`,
        method: 'GET',
        // No Authorization header — liveness probe scenario
      });

      expect(res.status).toBe(200);

      const body = res.body as { status: string };
      expect(body.status).toBe('ok');
    });

    // -------------------------------------------------------------------------
    // Test 2: compose-view RPC → info/refs → git-upload-pack sequence
    // -------------------------------------------------------------------------

    it('compose-view RPC returns a viewRef and commitOid', async () => {
      // Step 1: Call compose-view with a test user and namespaces.
      // This triggers VaultViewComposer.compose() and returns a per-user view ref.
      const { viewRef, commitOid } = await callComposeView(
        TEST_USER_ID,
        TEST_NAMESPACES,
      );

      // The viewRef must follow the "user-<uid>-view" convention.
      expect(viewRef).toBe(`user-${TEST_USER_ID}-view`);

      // The commitOid must be a valid 40-char SHA-1 hex string.
      expect(commitOid).toMatch(/^[0-9a-f]{40}$/);
    });

    it('GET /internal/git/info/refs?service=git-upload-pack returns git advertisement', async () => {
      // Step 1: Obtain a fresh view ref.
      const { viewRef } = await callComposeView(TEST_USER_ID, TEST_NAMESPACES);

      // Step 2: Hit the info/refs endpoint as a git client would.
      const res = await httpRequest({
        url: `${BASE_URL}/internal/git/info/refs?service=git-upload-pack`,
        method: 'GET',
        headers: {
          Authorization: AUTH_HEADER,
          'x-vault-view-ref': viewRef,
        },
      });

      // Must return 200 with the git-specific Content-Type.
      expect(res.status).toBe(200);
      expect(
        res.headers
          .get('content-type')
          ?.includes('application/x-git-upload-pack-advertisement'),
      ).toBe(true);

      // The response body (raw bytes as text) must begin with the git pkt-line
      // service prefix: "# service=git-upload-pack" encoded in pkt-line format.
      // The first 4 bytes of a pkt-line are a hex length.
      const bodyText = res.body as string;
      expect(bodyText).toContain('# service=git-upload-pack');
    });

    it('POST /internal/git/git-upload-pack returns 200 on a want request', async () => {
      // Step 1: Obtain a view ref.
      const { viewRef, commitOid } = await callComposeView(
        TEST_USER_ID,
        TEST_NAMESPACES,
      );

      // Step 2: Construct a minimal git pkt-line "want" message.
      // Format: "XXXX" (4-hex length) + "want <sha1>\n"
      const wantLine = `want ${commitOid}\n`;
      // Each pkt-line is prefixed with a 4-character hex length including the prefix itself.
      const lineLen = (wantLine.length + 4).toString(16).padStart(4, '0');
      // "0000" is the flush packet marking end of want list; "0009done\n" is the done packet.
      const requestBody = `${lineLen}${wantLine}00000009done\n`;

      const res = await fetch(`${BASE_URL}/internal/git/git-upload-pack`, {
        method: 'POST',
        headers: {
          Authorization: AUTH_HEADER,
          'x-vault-view-ref': viewRef,
          'Content-Type': 'application/x-git-upload-pack-request',
        },
        body: requestBody,
      });

      // Must return 200 with the pack Content-Type.
      expect(res.status).toBe(200);
      expect(
        res.headers
          .get('content-type')
          ?.includes('application/x-git-upload-pack-result'),
      ).toBe(true);

      // The response body must begin with pkt-line data (non-empty pack stream).
      const bodyBuf = Buffer.from(await res.arrayBuffer());
      expect(bodyBuf.length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // Test 3: actual `git clone` succeeds end-to-end
    // -------------------------------------------------------------------------

    it('git clone via smart HTTP succeeds and produces a valid local repo', {
      timeout: 30_000,
    }, async () => {
      // Step 1: Obtain a view ref so we can use it as GIT_NAMESPACE via the header.
      // In the real flow the git client sends the Authorization and view-ref headers
      // via a git credential helper or git config http.extraheader.
      const { viewRef } = await callComposeView(TEST_USER_ID, TEST_NAMESPACES);

      const cloneTarget = path.join(tmpCloneDir, 'cloned-repo');

      // Step 2: Run `git clone` using http.extraheader to inject the required headers.
      // git uses the helper git-remote-http which respects http.extraheader config.
      const { stdout, stderr } = await execFileAsync('git', [
        'clone',
        '--config',
        `http.extraheader=Authorization: ${AUTH_HEADER}`,
        '--config',
        `http.extraheader=x-vault-view-ref: ${viewRef}`,
        `${BASE_URL}/internal/git`,
        cloneTarget,
      ]);

      // Clone must exit 0 (execFileAsync throws on non-zero exit).
      // The output is informational — we assert the cloned directory exists.
      expect(stdout + stderr).toBeDefined(); // just ensure no uncaught exception

      // Step 3: Verify the cloned directory is a valid git repository.
      const gitDir = path.join(cloneTarget, '.git');
      const stat = await fs.promises.stat(gitDir);
      expect(stat.isDirectory()).toBe(true);

      // Step 4: Verify that `git log` lists at least one commit inside the clone.
      const { stdout: logOutput } = await execFileAsync(
        'git',
        ['log', '--oneline'],
        {
          cwd: cloneTarget,
        },
      );
      expect(logOutput.trim().length).toBeGreaterThan(0);

      // Step 5: Verify HEAD points to a valid commit SHA.
      const { stdout: revParse } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: cloneTarget },
      );
      expect(revParse.trim()).toMatch(/^[0-9a-f]{40}$/);
    });

    // -------------------------------------------------------------------------
    // Test 4: unauthenticated access to protected endpoints returns 401
    // -------------------------------------------------------------------------

    it('GET /internal/git/info/refs without Authorization returns 401', async () => {
      // Protected endpoints must reject requests without the shared secret.
      const res = await httpRequest({
        url: `${BASE_URL}/internal/git/info/refs?service=git-upload-pack`,
        method: 'GET',
        headers: {
          // No Authorization header
          'x-vault-view-ref': 'any-view-ref',
        },
      });

      expect(res.status).toBe(401);
    });

    it('POST /internal/compose-view without Authorization returns 401', async () => {
      const res = await httpRequest({
        url: `${BASE_URL}/internal/compose-view`,
        method: 'POST',
        headers: {
          // No Authorization header
        },
        body: { userId: TEST_USER_ID, namespaces: TEST_NAMESPACES },
      });

      expect(res.status).toBe(401);
    });

    // -------------------------------------------------------------------------
    // Test 5: Tree normalization — no-collision scenario (req 4.11)
    // -------------------------------------------------------------------------

    describe('Tree normalization: filename collision rules (req 4.10, 4.11)', () => {
      let normCloneDir: string;

      beforeAll(async () => {
        await connectMongo();
        normCloneDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'vault-norm-test-'),
        );
      });

      afterAll(async () => {
        await fs.promises.rm(normCloneDir, { recursive: true, force: true });
        await disconnectMongo();
      });

      it('no-collision: /Sandbox and /Sandbox/Bootstrap5 produce plain filenames without __hash suffix (req 4.11)', {
        timeout: 60_000,
      }, async () => {
        // Seed two pages into a dedicated namespace so they appear in the merged
        // view.  /Sandbox and /Sandbox/Bootstrap5 differ only in hierarchy and
        // have no lowercase-collision partner at their respective directory
        // levels — so the normalizer must leave both names unchanged (req 4.11:
        // group size 1 → no suffix).
        const ns = 'integ-norm-no-collision-ns';
        const userId = 'norm0000no00coll00000001';

        if (mongoose == null) {
          throw new Error('Mongoose not connected');
        }
        const { ObjectId } = mongoose.mongo;

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/Sandbox',
          revisionId: new ObjectId().toHexString(),
          bodyText: '# Sandbox\nTop-level sandbox page.',
        });

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/Sandbox/Bootstrap5',
          revisionId: new ObjectId().toHexString(),
          bodyText: '# Bootstrap5\nBootstrap5 examples.',
        });

        // Compose a view that includes only the test namespace.
        const { viewRef } = await callComposeView(userId, [ns]);

        const cloneTarget = path.join(normCloneDir, 'no-collision-clone');

        // Clone the view via smart HTTP.
        await execFileAsync('git', [
          'clone',
          '--config',
          `http.extraheader=Authorization: ${AUTH_HEADER}`,
          '--config',
          `http.extraheader=x-vault-view-ref: ${viewRef}`,
          `${BASE_URL}/internal/git`,
          cloneTarget,
        ]);

        const files = await listFilesRecursive(cloneTarget);

        // Both pages must appear with their plain, suffix-free names.
        expect(files).toContain('Sandbox.md');
        expect(files).toContain('Sandbox/Bootstrap5.md');

        // No file in the clone may carry a __<hex8> suffix — there are no
        // case-insensitive collisions in this namespace.
        const hashSuffixRe = /__[0-9a-f]{8}\./;
        const suffixed = files.filter((f) => hashSuffixRe.test(f));
        expect(suffixed).toHaveLength(0);
      });

      // -----------------------------------------------------------------------
      // Test 6: Tree normalization — case collision scenario (req 4.10)
      // -----------------------------------------------------------------------

      it('case-collision: /Foo and /foo both receive distinct __<hash8> suffixes (req 4.10)', {
        timeout: 60_000,
      }, async () => {
        // Seed two pages whose VaultPathMapper output differs only in case:
        //   /Foo  → Foo.md  (filePath before suffix)
        //   /foo  → foo.md  (filePath before suffix)
        // 'foo.md'.toLowerCase() === 'Foo.md'.toLowerCase() → collision group
        // size 2 → normalizer applies __<hash8> to both (req 4.10).
        //
        // The pre-suffix filePaths used as hash inputs are 'Foo.md' and
        // 'foo.md' (the full path from tree root, since both are at root level).
        const ns = 'integ-norm-case-collision-ns';
        const userId = 'norm0000case0coll0000001';

        if (mongoose == null) {
          throw new Error('Mongoose not connected');
        }
        const { ObjectId } = mongoose.mongo;

        // Pre-compute expected suffixed filenames so the assertion is
        // self-documenting and matches the normalizer's deterministic output.
        // hash8 = sha1(<preSuffixFilePath>).slice(0, 8)
        const fooHash8 = computeExpectedHash8('Foo.md'); // sha1('Foo.md')[0..7]
        const fooLcHash8 = computeExpectedHash8('foo.md'); // sha1('foo.md')[0..7]

        // The two hashes must differ — this is guaranteed by sha1's collision
        // resistance on distinct inputs, but we assert it explicitly so a test
        // failure here gives an immediate diagnostic rather than a silent wrong
        // assertion below.
        expect(fooHash8).not.toBe(fooLcHash8);

        const expectedFooFile = `Foo__${fooHash8}.md`;
        const expectedFooLcFile = `foo__${fooLcHash8}.md`;

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/Foo',
          revisionId: new ObjectId().toHexString(),
          bodyText: '# Foo\nUpper-case Foo page.',
        });

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/foo',
          revisionId: new ObjectId().toHexString(),
          bodyText: '# foo\nLower-case foo page.',
        });

        // Compose a view for this namespace.
        const { viewRef } = await callComposeView(userId, [ns]);

        const cloneTarget = path.join(normCloneDir, 'case-collision-clone');

        // Clone the view.
        await execFileAsync('git', [
          'clone',
          '--config',
          `http.extraheader=Authorization: ${AUTH_HEADER}`,
          '--config',
          `http.extraheader=x-vault-view-ref: ${viewRef}`,
          `${BASE_URL}/internal/git`,
          cloneTarget,
        ]);

        const files = await listFilesRecursive(cloneTarget);

        // Both suffixed filenames must be present.
        expect(files).toContain(expectedFooFile);
        expect(files).toContain(expectedFooLcFile);

        // The two suffixed names must be distinct (req 4.10: each member gets a
        // DIFFERENT suffix).
        expect(expectedFooFile).not.toBe(expectedFooLcFile);

        // Neither plain 'Foo.md' nor plain 'foo.md' may appear — the collision
        // group has 2 members so both must carry a suffix.
        expect(files).not.toContain('Foo.md');
        expect(files).not.toContain('foo.md');
      });
    });
  },
);
