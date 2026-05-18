/**
 * Gateway contract tests for the GROWI Vault.
 *
 * Fixture (apps/app + vault-manager + mongo + seeded users/pages) is provided
 * by the globalSetup at `test/setup/vault-e2e/global-setup.ts`. The setup
 * exports the `MONGO_URI` so individual test suites can perform direct DB
 * writes to set up scenarios (vaultEnabled toggle, bootstrap state, etc.)
 * without depending on admin-session auth.
 *
 * Until the globalSetup ships, `isVaultE2eFixtureReady()` returns false and
 * this suite is skipped. Once it lands, env vars are always set and these
 * tests run unconditionally on every CI run.
 *
 * Each contract is documented inline with what regression it would catch.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  isVaultE2eFixtureReady,
  VAULT_E2E_CONFIG,
  VAULT_E2E_PAGES,
} from './fixture-contract';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// DB helpers — used to drive scenarios that require state changes the
// gateway itself doesn't expose to test code (vaultEnabled flag, bootstrap
// state). The mongo URI is exported by globalSetup.
// ---------------------------------------------------------------------------

function mongoUri(): string {
  const uri = process.env.MONGO_URI;
  if (uri == null || uri === '') {
    throw new Error(
      'MONGO_URI not set. globalSetup must export it for vault gateway tests.',
    );
  }
  return uri;
}

async function withDb<T>(
  fn: (db: import('mongodb').Db) => Promise<T>,
): Promise<T> {
  const client = new MongoClient(mongoUri());
  try {
    await client.connect();
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

async function setVaultEnabled(enabled: boolean): Promise<void> {
  await withDb(async (db) => {
    await db
      .collection('configs')
      .updateOne(
        { key: 'app:vaultEnabled' },
        { $set: { value: JSON.stringify(enabled) } },
        { upsert: true },
      );
  });
}

async function setBootstrapState(
  state: 'pending' | 'running' | 'done' | 'failed',
): Promise<void> {
  await withDb(async (db) => {
    await db
      .collection('vault_sync_state')
      .updateOne(
        { _id: 'singleton' as unknown as never },
        { $set: { bootstrapState: state } },
        { upsert: true },
      );
  });
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const basicAuthHeader = (pat: string): string =>
  `Basic ${Buffer.from(`x:${pat}`).toString('base64')}`;

async function probeInfoRefs(opts: {
  pat?: string;
}): Promise<{ status: number; headers: Headers }> {
  const url = `${VAULT_E2E_CONFIG.baseUrl}/_vault/repo.git/info/refs?service=git-upload-pack`;
  const headers: Record<string, string> = {};
  if (opts.pat) headers.Authorization = basicAuthHeader(opts.pat);

  const res = await fetch(url, { headers, redirect: 'manual' });
  return { status: res.status, headers: res.headers };
}

async function probeReceivePack(method: 'POST' | 'GET'): Promise<number> {
  const url = `${VAULT_E2E_CONFIG.baseUrl}/_vault/repo.git/git-receive-pack`;
  const init: RequestInit = { method, redirect: 'manual' };
  if (method === 'POST') {
    init.headers = {
      'Content-Type': 'application/x-git-receive-pack-request',
    };
    init.body = '';
  }
  const res = await fetch(url, init);
  return res.status;
}

async function gitCloneAdmin(): Promise<string> {
  const url = new URL(`${VAULT_E2E_CONFIG.baseUrl}/_vault/repo.git`);
  url.username = 'x';
  url.password = VAULT_E2E_CONFIG.admin.pat;
  const dir = await mkdtemp(join(tmpdir(), 'growi-vault-gw-'));
  await execFileAsync('git', ['clone', url.toString(), dir]);
  return dir;
}

async function listFiles(repoDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, 'ls-files']);
  return stdout.trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!isVaultE2eFixtureReady())(
  'GROWI Vault — gateway contracts',
  () => {
    const tmpDirs: string[] = [];

    afterEach(async () => {
      // Restore the steady-state (enabled + bootstrap done) after any test
      // that mutates it.
      await setVaultEnabled(true);
      await setBootstrapState('done');
    });

    afterAll(async () => {
      await Promise.all(
        tmpDirs.map((d) => rm(d, { recursive: true, force: true })),
      );
    });

    // ----------------------------------------------------------------------
    // Contract: vaultEnabled=false → 404 (permanent, no Retry-After).
    //
    // Regression catch: someone changes the disabled response to 503 or 200,
    // breaking the documented "feature flag returns 404" contract and
    // confusing clients about whether to retry.
    // ----------------------------------------------------------------------
    describe('feature flag', () => {
      beforeAll(async () => {
        await setVaultEnabled(false);
      });

      it('returns 404 for info/refs when vaultEnabled=false', async () => {
        const res = await probeInfoRefs({ pat: VAULT_E2E_CONFIG.admin.pat });
        expect(res.status).toBe(404);
        expect(res.headers.get('retry-after')).toBeNull();
      });

      it('returns 404 for anonymous info/refs when vaultEnabled=false', async () => {
        const res = await probeInfoRefs({});
        expect(res.status).toBe(404);
      });
    });

    // ----------------------------------------------------------------------
    // Contract: bootstrapState ≠ 'done' → 503. 'running' must set
    // Retry-After so clients back off; 'pending' and 'failed' must NOT
    // set Retry-After (they need admin intervention, not waiting).
    //
    // Regression catch: any handler change that drops Retry-After during
    // running, or accidentally adds it during pending/failed, would mislead
    // git clients about retry strategy.
    // ----------------------------------------------------------------------
    describe('bootstrap state', () => {
      it('returns 503 with Retry-After while bootstrapState=running', async () => {
        await setBootstrapState('running');
        const res = await probeInfoRefs({ pat: VAULT_E2E_CONFIG.admin.pat });
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBeTruthy();
      });

      it('returns 503 without Retry-After while bootstrapState=pending', async () => {
        await setBootstrapState('pending');
        const res = await probeInfoRefs({ pat: VAULT_E2E_CONFIG.admin.pat });
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBeNull();
      });

      it('returns 503 without Retry-After while bootstrapState=failed', async () => {
        await setBootstrapState('failed');
        const res = await probeInfoRefs({ pat: VAULT_E2E_CONFIG.admin.pat });
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBeNull();
      });
    });

    // ----------------------------------------------------------------------
    // Contract: the vault repo is read-only. ANY method on
    // /git-receive-pack must return 403.
    //
    // Regression catch: a routing change that exposes a writable path would
    // be a critical security issue — this test would fail loudly.
    // ----------------------------------------------------------------------
    describe('read-only enforcement', () => {
      it('returns 403 for POST git-receive-pack', async () => {
        const status = await probeReceivePack('POST');
        expect(status).toBe(403);
      });

      it('returns 403 for GET git-receive-pack', async () => {
        const status = await probeReceivePack('GET');
        expect(status).toBe(403);
      });
    });

    // ----------------------------------------------------------------------
    // Contract: in the steady state (enabled + bootstrap done), a clone with
    // a valid PAT must succeed and contain at least one of the fixture pages.
    //
    // This is the smoke check; the per-page body assertions live in
    // clone-e2e.integ.ts.
    // ----------------------------------------------------------------------
    it('admin clone succeeds at steady state', async () => {
      const dir = await gitCloneAdmin();
      tmpDirs.push(dir);
      const files = await listFiles(dir);
      expect(files).toContain(VAULT_E2E_PAGES.publicRoot.mappedFile);
    });

    // ----------------------------------------------------------------------
    // Contract: when many page updates on a single namespace land inside the
    // coalesce window, the dispatcher must emit a single 'bulk-upsert'
    // instruction (instead of N individual 'upsert' instructions).
    //
    // Regression catch: changing the coalesce threshold/window or the
    // dispatcher's flush condition would cause N upserts to be written,
    // which we'd catch by counting the upsert / bulk-upsert documents.
    //
    // We seed the dispatcher directly by inserting page documents and
    // emitting events would require a running PageService — for an
    // integration test focused on the gateway boundary we instead exercise
    // the dispatcher via its public entry point by writing the resulting
    // vault_instructions directly. This test is intentionally an end-to-end
    // probe of the OUTBOX contract, not of the in-memory coalescer (the
    // coalescer has its own unit tests).
    //
    // We assert on the steady-state shape of the outbox after the burst.
    // ----------------------------------------------------------------------
    it('high-frequency edits on one namespace coalesce into bulk-upsert', async () => {
      // Pre-state: clear any pre-existing test instructions
      await withDb(async (db) => {
        await db
          .collection('vault_instructions')
          .deleteMany({ 'payload.namespace': 'vault-e2e-coalesce' });
      });

      // Trigger N>threshold upserts via the dispatcher's HTTP entry point.
      // The dispatcher coalesces these into one bulk-upsert.
      const N = 150;
      const url = `${VAULT_E2E_CONFIG.baseUrl}/_api/v3/vault/test/emit-upserts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: basicAuthHeader(VAULT_E2E_CONFIG.admin.pat),
        },
        body: JSON.stringify({ namespace: 'vault-e2e-coalesce', count: N }),
      });
      expect(res.status, 'test helper endpoint must be available').toBe(200);

      // Wait one coalesce window + buffer.
      await new Promise((r) => setTimeout(r, 1500));

      const { bulkUpserts, upserts } = await withDb(async (db) => {
        const docs = await db
          .collection('vault_instructions')
          .find({ 'payload.namespace': 'vault-e2e-coalesce' })
          .toArray();
        return {
          bulkUpserts: docs.filter((d) => d.op === 'bulk-upsert').length,
          upserts: docs.filter((d) => d.op === 'upsert').length,
        };
      });

      expect(bulkUpserts).toBeGreaterThanOrEqual(1);
      expect(upserts).toBe(0);
    });

    // ----------------------------------------------------------------------
    // Contract: auto-generated intermediate path pages with revision=null
    // must be skipped — they must not break bootstrap and must not appear
    // in the cloned tree.
    //
    // Regression catch: this was a real bug — null revisions crashed
    // vault-manager with a MongoDB CastError. Re-introducing the bug would
    // either leave bootstrapState='failed' or break the clone.
    // ----------------------------------------------------------------------
    it('null-revision intermediate pages are excluded from clone', async () => {
      // Insert a null-revision parent page directly to simulate the
      // GROWI intermediate-page auto-generation behaviour.
      const parentPath = '/vault-e2e-null-rev';
      const orphanFilename = 'vault-e2e-null-rev.md';
      await withDb(async (db) => {
        await db.collection('pages').insertOne({
          path: parentPath,
          status: 'published',
          grant: 1, // GRANT_PUBLIC
          revision: null,
        });
      });

      // Trigger a bootstrap to pick up the new page.
      await setBootstrapState('pending');
      await fetch(`${VAULT_E2E_CONFIG.baseUrl}/_api/v3/vault/test/bootstrap`, {
        method: 'POST',
        headers: { Authorization: basicAuthHeader(VAULT_E2E_CONFIG.admin.pat) },
      });

      // Poll until bootstrap completes. Sequential await is intentional —
      // we need to back off between checks rather than fire concurrent reads.
      const deadline = Date.now() + 30_000;
      let lastState = '';
      while (Date.now() < deadline) {
        // biome-ignore lint: poll-and-back-off pattern requires sequential awaits
        const state = await withDb(async (db) => {
          const doc = await db
            .collection('vault_sync_state')
            .findOne({ _id: 'singleton' as unknown as never });
          return doc?.bootstrapState as string | undefined;
        });
        lastState = state ?? '';
        if (lastState === 'done' || lastState === 'failed') break;
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(
        lastState,
        'bootstrap must reach done — null revisions must not crash the pipeline',
      ).toBe('done');

      const dir = await gitCloneAdmin();
      tmpDirs.push(dir);
      const files = await listFiles(dir);
      expect(
        files,
        'null-revision page must not appear in the clone',
      ).not.toContain(orphanFilename);
    });
  },
);
