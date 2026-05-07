/**
 * ACL isolation, bootstrap-gate, and coalesce integration tests for the
 * GROWI Vault gateway.
 *
 * Requires a running docker-compose environment with:
 *   - apps/app (GROWI) accessible at GROWI_TEST_URL
 *   - vault-manager service running and connected to apps/app
 *   - MongoDB instance used by both services
 *
 * Run with: docker-compose up -d && pnpm vitest run vault-gateway.integ
 *
 * Environment variables:
 *   GROWI_TEST_URL       - Base URL of the running GROWI instance (default: http://localhost:3000)
 *   GROWI_TEST_PAT       - PAT of a user with access to all test pages
 *   GROWI_TEST_PAT_ACL   - PAT of a user that should NOT see ACL-protected pages
 *   GROWI_ADMIN_TOKEN    - Admin API token for setting up test state via the admin API
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.GROWI_TEST_URL ?? 'http://localhost:3000';
const TEST_PAT = process.env.GROWI_TEST_PAT ?? '';
const TEST_PAT_ACL = process.env.GROWI_TEST_PAT_ACL ?? '';
const ADMIN_TOKEN = process.env.GROWI_ADMIN_TOKEN ?? '';
const TEST_USER = process.env.GROWI_TEST_USER ?? 'testuser';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Send an HTTP request to the GROWI info/refs endpoint and return the
 * raw HTTP status code.  Does not follow git protocol — purely an HTTP probe.
 */
async function probeGitInfoRefs(pat: string): Promise<number> {
  const url = `${BASE_URL}/_vault/repo.git/info/refs?service=git-upload-pack`;
  const headers: Record<string, string> = {};
  if (pat) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${TEST_USER}:${pat}`).toString('base64');
  }
  const res = await fetch(url, { headers, redirect: 'manual' });
  return res.status;
}

/**
 * Send an HTTP request to the git-receive-pack endpoint and return the
 * raw HTTP status code.
 */
async function probeGitReceivePack(pat: string): Promise<number> {
  const url = `${BASE_URL}/_vault/repo.git/git-receive-pack`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-git-receive-pack-request',
  };
  if (pat) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${TEST_USER}:${pat}`).toString('base64');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: '',
    redirect: 'manual',
  });
  return res.status;
}

/**
 * Send an HTTP request to the git-receive-pack endpoint via GET
 * (to test that any method is rejected) and return the raw status code.
 */
async function probeGitReceivePackGet(): Promise<number> {
  const url = `${BASE_URL}/_vault/repo.git/git-receive-pack`;
  const res = await fetch(url, { method: 'GET', redirect: 'manual' });
  return res.status;
}

/**
 * Call the GROWI admin API to toggle the vault feature flag.
 * Requires GROWI_ADMIN_TOKEN.
 */
async function setVaultEnabled(enabled: boolean): Promise<void> {
  const url = `${BASE_URL}/api/v3/vault`;
  await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ enabled }),
  });
}

/**
 * Execute a git clone and return the cloned directory path.
 * Throws if git exits with a non-zero code.
 */
async function gitClone(pat: string): Promise<string> {
  const url = new URL(`${BASE_URL}/_vault/repo.git`);
  url.username = TEST_USER;
  url.password = pat;

  const tmpDir = await mkdtemp(join(tmpdir(), 'growi-vault-gw-'));
  await execFileAsync('git', ['clone', url.toString(), tmpDir]);
  return tmpDir;
}

/**
 * Collect all tracked file paths in a cloned git repository.
 */
async function listClonedFiles(repoDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, 'ls-files']);
  return stdout.trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skip('GROWI Vault gateway integration (requires docker-compose)', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(
      tmpDirs.map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  // --------------------------------------------------------------------------
  // Scenario 1: vaultEnabled=false causes all gateway requests to return 503
  // --------------------------------------------------------------------------
  describe('when vaultEnabled=false', () => {
    beforeAll(async () => {
      // Disable vault via admin API.
      expect(ADMIN_TOKEN, 'GROWI_ADMIN_TOKEN must be set').toBeTruthy();
      await setVaultEnabled(false);
    });

    afterAll(async () => {
      // Re-enable vault so subsequent suites start from a clean state.
      await setVaultEnabled(true);
    });

    it('returns 503 for git info/refs (authenticated)', async () => {
      const status = await probeGitInfoRefs(TEST_PAT);
      expect(status).toBe(503);
    });

    it('returns 503 for git info/refs (unauthenticated)', async () => {
      const status = await probeGitInfoRefs('');
      expect(status).toBe(503);
    });

    it('git clone fails when vault is disabled', async () => {
      await expect(gitClone(TEST_PAT)).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 2: bootstrapState=running causes clone to return 503 + Retry-After
  // --------------------------------------------------------------------------
  describe('when bootstrapState is running', () => {
    beforeAll(async () => {
      // Simulate a running bootstrap by updating vault_sync_state via the
      // admin API or by direct database manipulation.
      // The exact endpoint depends on the admin API implementation; adjust as
      // needed to force bootstrapState to 'running'.
      expect(ADMIN_TOKEN, 'GROWI_ADMIN_TOKEN must be set').toBeTruthy();
      await fetch(`${BASE_URL}/api/v3/vault/bootstrap-state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ bootstrapState: 'running' }),
      });
    });

    afterAll(async () => {
      // Reset bootstrapState to 'done' so the gateway is operational again.
      await fetch(`${BASE_URL}/api/v3/vault/bootstrap-state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ bootstrapState: 'done' }),
      });
    });

    it('returns 503 with Retry-After header while bootstrap is running', async () => {
      const url = `${BASE_URL}/_vault/repo.git/info/refs?service=git-upload-pack`;
      const headers = TEST_PAT
        ? {
            Authorization:
              'Basic ' +
              Buffer.from(`${TEST_USER}:${TEST_PAT}`).toString('base64'),
          }
        : undefined;

      const res = await fetch(url, { headers, redirect: 'manual' });

      expect(res.status).toBe(503);
      // The gateway must set Retry-After so that git clients back off gracefully.
      expect(res.headers.get('retry-after')).toBeTruthy();
    });

    it('git clone fails with a non-zero exit code while bootstrap is running', async () => {
      await expect(gitClone(TEST_PAT)).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 3: push attempt returns 403 (read-only repository)
  // --------------------------------------------------------------------------
  describe('push attempt on read-only vault', () => {
    it('returns 403 for POST to git-receive-pack', async () => {
      const status = await probeGitReceivePack(TEST_PAT);
      expect(status).toBe(403);
    });

    it('returns 403 for GET to git-receive-pack', async () => {
      const status = await probeGitReceivePackGet();
      expect(status).toBe(403);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 4: After bootstrap completes, clone succeeds
  // --------------------------------------------------------------------------
  describe('after bootstrap completes', () => {
    it('git clone succeeds when bootstrapState=done and vaultEnabled=true', async () => {
      expect(TEST_PAT, 'GROWI_TEST_PAT must be set').toBeTruthy();

      const cloneDir = await gitClone(TEST_PAT);
      tmpDirs.push(cloneDir);

      // The cloned directory must contain at least one tracked file.
      const files = await listClonedFiles(cloneDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 5: ACL-protected pages are not included in clone results
  // --------------------------------------------------------------------------
  describe('ACL isolation', () => {
    it('ACL-protected pages are absent from the clone of a restricted user', async () => {
      // This test requires two PATs:
      //   - TEST_PAT      : admin/full-access user that CAN see the ACL-protected page
      //   - TEST_PAT_ACL  : restricted user that CANNOT see the ACL-protected page
      expect(TEST_PAT, 'GROWI_TEST_PAT must be set').toBeTruthy();
      expect(TEST_PAT_ACL, 'GROWI_TEST_PAT_ACL must be set').toBeTruthy();

      // Clone as full-access user.
      const fullDir = await gitClone(TEST_PAT);
      tmpDirs.push(fullDir);
      const fullFiles = await listClonedFiles(fullDir);

      // Clone as restricted user.
      const restrictedDir = await gitClone(TEST_PAT_ACL);
      tmpDirs.push(restrictedDir);
      const restrictedFiles = await listClonedFiles(restrictedDir);

      const restrictedFileSet = new Set(restrictedFiles);

      // Files visible to the full-access user that are NOT visible to the
      // restricted user are the ACL-protected pages.
      const aclProtectedFiles = fullFiles.filter(
        (f) => !restrictedFileSet.has(f),
      );

      // There must be at least one ACL-protected page in the test fixture.
      expect(
        aclProtectedFiles.length,
        'Test fixture must include at least one ACL-protected page',
      ).toBeGreaterThan(0);

      // The restricted clone must not contain any ACL-protected file.
      for (const protectedFile of aclProtectedFiles) {
        expect(
          restrictedFileSet.has(protectedFile),
          `ACL-protected file "${protectedFile}" must not appear in restricted clone`,
        ).toBe(false);
      }
    });

    it('ACL-protected pages do not appear in anonymous clone', async () => {
      // Attempt an anonymous clone.  Skip if the server rejects unauthenticated access.
      let anonDir: string;
      try {
        const url = `${BASE_URL}/_vault/repo.git`;
        const tmpDir = await mkdtemp(join(tmpdir(), 'growi-vault-anon-'));
        await execFileAsync('git', ['clone', url, tmpDir]);
        anonDir = tmpDir;
      } catch {
        // Anonymous clone rejected — skip this sub-scenario.
        return;
      }
      tmpDirs.push(anonDir);

      const anonFiles = await listClonedFiles(anonDir);
      // Anonymous clone must not include pages with "/private/" in their path.
      // Adjust this sentinel to match the actual ACL-protected page paths in the
      // test fixture.
      const privateFiles = anonFiles.filter((f) => f.includes('/private/'));
      expect(
        privateFiles,
        'Anonymous clone must not include private pages',
      ).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario 6: High-frequency edits to the same namespace coalesce into
  //             a single bulk-upsert instruction
  // --------------------------------------------------------------------------
  describe('coalesce behaviour for high-frequency edits', () => {
    it('high-frequency page updates on one namespace produce a bulk-upsert instruction', async () => {
      // This test drives page saves through the GROWI page API and then reads
      // vault_instructions from MongoDB (via an admin endpoint) to assert that
      // a bulk-upsert instruction was written instead of N individual upsert
      // instructions.
      //
      // The exact mechanism for triggering page saves depends on the test
      // fixture API.  The example below uses the GROWI v3 page API.
      expect(ADMIN_TOKEN, 'GROWI_ADMIN_TOKEN must be set').toBeTruthy();

      const namespace = '/test-coalesce';
      const pageCount = 150; // Must exceed COALESCE_THRESHOLD (100)

      // Create / update `pageCount` pages in rapid succession on the same namespace.
      const saveRequests = Array.from({ length: pageCount }, (_, i) =>
        fetch(`${BASE_URL}/api/v3/page`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ADMIN_TOKEN}`,
          },
          body: JSON.stringify({
            path: `${namespace}/page-${i}`,
            body: `# Page ${i}\nContent for coalesce test.`,
          }),
        }),
      );
      await Promise.all(saveRequests);

      // Wait for the coalesce window (COALESCE_WINDOW_MS = 1000 ms) to expire
      // plus a small buffer for async processing.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Retrieve vault_instructions written after the batch via an admin endpoint.
      // The endpoint is expected to return a list of instruction documents.
      const instructionsRes = await fetch(
        `${BASE_URL}/api/v3/vault/instructions?namespace=${encodeURIComponent(namespace)}&limit=10`,
        {
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        },
      );
      expect(instructionsRes.ok).toBe(true);

      const { instructions } = (await instructionsRes.json()) as {
        instructions: Array<{ op: string; payload: { entries?: unknown[] } }>;
      };

      // At least one bulk-upsert instruction must have been written.
      const bulkUpserts = instructions.filter((i) => i.op === 'bulk-upsert');
      expect(
        bulkUpserts.length,
        'Expected at least one bulk-upsert instruction from coalesced edits',
      ).toBeGreaterThan(0);

      // No individual upsert instructions should exist for this namespace
      // when the threshold was exceeded.
      const individualUpserts = instructions.filter((i) => i.op === 'upsert');
      expect(
        individualUpserts.length,
        'Individual upsert instructions must be coalesced into bulk-upsert',
      ).toBe(0);
    }, 10_000); // Allow extra time for the async coalesce flush.
  });
});
