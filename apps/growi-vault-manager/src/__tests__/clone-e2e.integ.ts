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

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PUBLISHED_SPARSE_FILTERS,
  sparseFilterOid,
  sparseFilterRefPath,
} from '../services/vault-sparse-filter.js';

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

    // -------------------------------------------------------------------------
    // Objects outside the requester's view must not be served (req 5.4 / 5.6)
    // -------------------------------------------------------------------------

    describe('Objects outside the view (req 5.4)', () => {
      beforeAll(async () => {
        await connectMongo();
      });

      afterAll(async () => {
        await disconnectMongo();
      });

      /**
       * Runs git against the bare repository the manager maintains.
       * Only possible when the manager runs in-process (the default integ
       * setup), which is where VAULT_REPO_PATH points at a local directory.
       */
      const gitInRepo = async (...args: string[]): Promise<string> => {
        const repoPath = process.env.VAULT_REPO_PATH;
        if (repoPath == null || !fs.existsSync(repoPath)) {
          throw new Error('VAULT_REPO_PATH is not a local directory');
        }
        const { stdout } = await execFileAsync('git', [
          '-C',
          repoPath,
          ...args,
        ]);
        return stdout.trim();
      };

      /** Sends a hand-built want request, the way a non-git client would. */
      const postWant = async (
        viewRef: string,
        oid: string,
      ): Promise<{ status: number; body: Buffer }> => {
        const wantLine = `want ${oid} thin-pack ofs-delta agent=integ\n`;
        const len = (wantLine.length + 4).toString(16).padStart(4, '0');
        const res = await fetch(`${BASE_URL}/internal/git/git-upload-pack`, {
          method: 'POST',
          headers: {
            Authorization: AUTH_HEADER,
            'x-vault-view-ref': viewRef,
            'Content-Type': 'application/x-git-upload-pack-request',
          },
          body: `${len}${wantLine}00000009done\n`,
        });
        return {
          status: res.status,
          body: Buffer.from(await res.arrayBuffer()),
        };
      };

      it('does not serve a page body that belongs to a namespace the requester cannot access', {
        timeout: 60_000,
      }, async () => {
        if (mongoose == null) {
          throw new Error('Mongoose not connected');
        }
        const { ObjectId } = mongoose.mongo;

        // Seed a page into a private namespace of some *other* user.
        const otherNamespace = 'user-0badc0de0badc0de0badc0de-only-me';
        await upsertPageAndWait({
          namespace: otherNamespace,
          pageId: new ObjectId().toHexString(),
          pagePath: '/leak-probe/secret',
          revisionId: new ObjectId().toHexString(),
          bodyText: 'another users private page body\n',
        });

        // Object names of that page's content, read straight out of the shared
        // object store — this is what an attacker would have recorded earlier.
        const otherRef = `refs/namespaces/${otherNamespace}/refs/heads/main`;
        const foreignBlob = await gitInRepo(
          'rev-parse',
          `${otherRef}:leak-probe/secret.md`,
        );
        const foreignTree = await gitInRepo('rev-parse', `${otherRef}^{tree}`);

        // The requester's own view does not include that namespace.
        const { viewRef } = await callComposeView(
          TEST_USER_ID,
          TEST_NAMESPACES,
        );

        for (const oid of [foreignBlob, foreignTree]) {
          const { body } = await postWant(viewRef, oid);

          // A pack in the response means the object was handed over.
          expect(body.includes(Buffer.from('PACK'))).toBe(false);
          expect(body.toString('utf8')).toContain('ERR');
        }
      });

      it('still serves the commit its own view advertises', {
        timeout: 60_000,
      }, async () => {
        const { viewRef, commitOid } = await callComposeView(
          TEST_USER_ID,
          TEST_NAMESPACES,
        );

        const { status, body } = await postWant(viewRef, commitOid);

        expect(status).toBe(200);
        expect(body.includes(Buffer.from('PACK'))).toBe(true);
      });
    });

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

      // -----------------------------------------------------------------------
      // Test 7: Tree normalization — byte-length budget (req 4.12)
      // -----------------------------------------------------------------------

      it('over-long name: a page whose filename would exceed 255 bytes is still checked out, together with its neighbours (req 4.12)', {
        timeout: 60_000,
      }, async () => {
        // Reproduces issue #11596. An 85-character Japanese title maps to a
        // 258-byte filename, which ext4 / APFS reject with ENAMETOOLONG, and
        // `git clone` aborts the WHOLE checkout on the first rejected file.
        // The neighbouring page is therefore the real regression signal: it has
        // nothing wrong with its own name, yet before the fix it never reached
        // the working tree either.
        const ns = 'integ-norm-long-name-ns';
        const userId = 'norm0000long0name0000001';

        if (mongoose == null) {
          throw new Error('Mongoose not connected');
        }
        const { ObjectId } = mongoose.mongo;

        const longTitle = 'あ'.repeat(85);
        // Sanity-check the premise of this test: the un-shortened filename is
        // over the limit. If this ever stops holding, the test below would pass
        // for the wrong reason.
        expect(Buffer.byteLength(`${longTitle}.md`, 'utf8')).toBeGreaterThan(
          255,
        );

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: `/${longTitle}`,
          revisionId: new ObjectId().toHexString(),
          bodyText: '# long\nA long-title page.',
        });

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/Neighbour',
          revisionId: new ObjectId().toHexString(),
          bodyText: '# Neighbour\nA page with an ordinary name.',
        });

        const { viewRef } = await callComposeView(userId, [ns]);

        const cloneTarget = path.join(normCloneDir, 'long-name-clone');

        // Must not fail — before the fix this aborted with
        // 'error: unable to create file …: File name too long'.
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

        // The checkout ran to completion: the unrelated page is on disk.
        expect(files).toContain('Neighbour.md');

        // The long page is on disk too, under a shortened name: the stem is cut
        // to the 242 bytes left over by '__<hash8>' (10) and '.md' (3), i.e. 80
        // 3-byte characters, and hash8 is taken from the pre-suffix filePath —
        // the same rule as req 4.10.
        const expectedLongFile = `${'あ'.repeat(80)}__${computeExpectedHash8(`${longTitle}.md`)}.md`;
        expect(Buffer.byteLength(expectedLongFile, 'utf8')).toBeLessThanOrEqual(
          255,
        );
        expect(files).toContain(expectedLongFile);

        // Shortening touches the name only — the body is intact.
        const body = await fs.promises.readFile(
          path.join(cloneTarget, expectedLongFile),
          'utf8',
        );
        expect(body).toContain('A long-title page.');

        // git itself agrees the working tree matches the index, i.e. the
        // checkout was not left half-applied.
        const { stdout } = await execFileAsync('git', [
          '-C',
          cloneTarget,
          'status',
          '--porcelain',
        ]);
        expect(stdout.trim()).toBe('');
      });
    });

    // -------------------------------------------------------------------------
    // Partial clone: only a published sparse filter is served (req 5.9, 5.10)
    // -------------------------------------------------------------------------

    describe('Partial clone with a published sparse filter', () => {
      const spec = PUBLISHED_SPARSE_FILTERS[0];
      if (spec == null) {
        throw new Error('no sparse filter is published');
      }
      const publishedOid = sparseFilterOid(spec);

      let sparseCloneDir: string;

      beforeAll(async () => {
        await connectMongo();
        sparseCloneDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'vault-sparse-clone-'),
        );
      });

      afterAll(async () => {
        await disconnectMongo();
        if (sparseCloneDir != null) {
          await fs.promises.rm(sparseCloneDir, {
            recursive: true,
            force: true,
          });
        }
      });

      /** Runs git against the bare repository the manager maintains. */
      const gitInRepo = async (...args: string[]): Promise<string> => {
        const repoPath = process.env.VAULT_REPO_PATH;
        if (repoPath == null || !fs.existsSync(repoPath)) {
          throw new Error('VAULT_REPO_PATH is not a local directory');
        }
        const { stdout } = await execFileAsync('git', [
          '-C',
          repoPath,
          ...args,
        ]);
        return stdout.trim();
      };

      it('anchors the filter spec at the object name clients are told to pass', async () => {
        // The README publishes this object name; if the ref held anything else,
        // every documented clone command would name an object git cannot find.
        expect(
          await gitInRepo('rev-parse', sparseFilterRefPath(spec.name)),
        ).toBe(publishedOid);
        const stored = await execFileAsync('git', [
          '-C',
          process.env.VAULT_REPO_PATH ?? '',
          'cat-file',
          '-p',
          publishedOid,
        ]);
        expect(stored.stdout).toBe(spec.patterns);
      });

      it('serves a clone that excludes user pages, without sending their file bodies', {
        timeout: 120_000,
      }, async () => {
        if (mongoose == null) {
          throw new Error('Mongoose not connected');
        }
        const { ObjectId } = mongoose.mongo;
        const userId = 'aabbccddeeff00112233ff01';
        const ns = 'public';

        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/user/someone/private-memo',
          revisionId: new ObjectId().toHexString(),
          bodyText: 'a personal page body that must not be transferred\n',
        });
        await upsertPageAndWait({
          namespace: ns,
          pageId: new ObjectId().toHexString(),
          pagePath: '/sparse-probe/kept',
          revisionId: new ObjectId().toHexString(),
          bodyText: '# Kept\nAn ordinary wiki page.\n',
        });

        const { viewRef } = await callComposeView(userId, [ns]);
        const viewRefPath = `refs/namespaces/${viewRef}/refs/heads/main`;

        // The object name of the excluded page's body, read from the bare repo.
        const excludedBlob = await gitInRepo(
          'rev-parse',
          `${viewRefPath}:user/someone/private-memo.md`,
        );

        const cloneTarget = path.join(sparseCloneDir, 'filtered-clone');
        await execFileAsync('git', [
          'clone',
          '--config',
          `http.extraheader=Authorization: ${AUTH_HEADER}`,
          '--config',
          `http.extraheader=x-vault-view-ref: ${viewRef}`,
          `--filter=sparse:oid=${publishedOid}`,
          '--no-checkout',
          `${BASE_URL}/internal/git`,
          cloneTarget,
        ]);

        // The client applies the same patterns locally, so its checkout asks
        // for nothing the server left out.
        await execFileAsync('git', ['sparse-checkout', 'init', '--no-cone'], {
          cwd: cloneTarget,
        });
        execFileSync('git', ['sparse-checkout', 'set', '--stdin'], {
          cwd: cloneTarget,
          input: spec.patterns,
        });
        await execFileAsync('git', ['checkout', 'HEAD'], { cwd: cloneTarget });

        const files = await listFilesRecursive(cloneTarget);

        // The checkout ran to completion for everything outside user/.
        expect(files).toContain('sparse-probe/kept.md');
        expect(files.some((p) => p.startsWith('user/'))).toBe(false);

        // The point of the filter: the excluded body was never transferred, so
        // it is not in the clone's object store either.
        await expect(
          execFileAsync('git', ['cat-file', '-e', excludedBlob], {
            cwd: cloneTarget,
          }),
        ).rejects.toThrow();

        // git considers the working tree clean, i.e. the checkout was not left
        // half-applied by a rejected object request.
        const { stdout: status } = await execFileAsync(
          'git',
          ['status', '--porcelain'],
          { cwd: cloneTarget },
        );
        expect(status.trim()).toBe('');
      });

      it('refuses a filter it does not serve at clone time, instead of failing the checkout later', {
        timeout: 60_000,
      }, async () => {
        // With the filter capability advertised, git accepts --filter=blob:none
        // and defers every file body — which it would then fetch one object at a
        // time, and the want guard refuses those. Left unchecked, this exact
        // command reports "Clone succeeded, but checkout failed" after a wall of
        // per-object errors and leaves an empty working tree. Written the way a
        // user would type it, so that outcome is what the test rules out.
        const { viewRef } = await callComposeView(
          TEST_USER_ID,
          TEST_NAMESPACES,
        );
        const cloneTarget = path.join(sparseCloneDir, 'blobless-clone');

        await expect(
          execFileAsync('git', [
            'clone',
            '--config',
            `http.extraheader=Authorization: ${AUTH_HEADER}`,
            '--config',
            `http.extraheader=x-vault-view-ref: ${viewRef}`,
            '--filter=blob:none',
            `${BASE_URL}/internal/git`,
            cloneTarget,
          ]),
        ).rejects.toThrow(/unsupported partial-clone filter/);
      });
    });
  },
);
