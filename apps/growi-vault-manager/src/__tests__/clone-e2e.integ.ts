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
  },
);
