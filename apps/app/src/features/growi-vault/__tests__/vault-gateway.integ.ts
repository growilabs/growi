/**
 * Gateway contract tests for the GROWI Vault.
 *
 * The fixture (vault-manager + mounted gateway + seeded users/pages) is
 * provisioned once per run by `test/setup/vault-e2e/index.ts`. Tests drive
 * scenario state via direct mongoose writes and `configManager.updateConfigs`
 * — no admin-session auth required.
 *
 * Each contract below is documented with the regression it would catch.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getVaultE2eHandle } from '../../../../test/setup/vault-e2e';
import { VAULT_E2E_CONFIG, VAULT_E2E_PAGES } from './fixture-contract';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// DB helpers — drive scenarios that require state changes the gateway itself
// doesn't expose to test code (vaultEnabled flag, bootstrap state). We reuse
// the mongoose connection established by the shared mongo setup file.
// ---------------------------------------------------------------------------

function db(): import('mongodb').Db {
  const conn = mongoose.connection.db;
  if (conn == null) {
    throw new Error(
      'mongoose connection not established. The vault E2E setup must run before these tests.',
    );
  }
  return conn;
}

async function setVaultEnabled(enabled: boolean): Promise<void> {
  // Use configManager.updateConfigs so the in-memory cache is refreshed
  // alongside the DB write — raw DB updates would not affect the gateway's
  // resolved value until configManager.loadConfigs() runs again.
  const { configManager } = await import('~/server/service/config-manager');
  await configManager.updateConfigs({ 'app:vaultEnabled': enabled });
}

async function setBootstrapState(
  state: 'pending' | 'running' | 'done' | 'failed',
): Promise<void> {
  await db()
    .collection('vault_sync_state')
    .updateOne(
      { _id: 'singleton' as unknown as never },
      { $set: { bootstrapState: state } },
      { upsert: true },
    );
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

describe('GROWI Vault — gateway contracts', () => {
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
    // beforeEach (not beforeAll) — the outer afterEach restores the steady
    // state between tests, so each test inside this block must re-disable.
    beforeEach(async () => {
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
  // which we'd catch by counting the documents on the vault_instructions
  // outbox.
  // ----------------------------------------------------------------------
  it('high-frequency edits on one namespace coalesce into bulk-upsert', async () => {
    // Pre-state: remove any prior instructions on the public namespace so
    // assertions below are not polluted by the bootstrap that ran during
    // provisioning.
    const namespaceFilter = { 'payload.namespace': 'public' };
    await db().collection('vault_instructions').deleteMany(namespaceFilter);

    // Drive the dispatcher directly via its public entry point. Each call
    // emits an update for a public-grant page; the dispatcher's coalescer
    // is responsible for merging the burst into one bulk-upsert.
    const { dispatcher } = getVaultE2eHandle();
    const N = 150;
    const updates = Array.from({ length: N }, (_, i) => {
      const pageId = new mongoose.Types.ObjectId();
      const revisionId = new mongoose.Types.ObjectId();
      return dispatcher.onPageChanged({
        type: 'update',
        page: {
          _id: pageId,
          path: `/vault-e2e-coalesce/page-${i}`,
          grant: 1, // GRANT_PUBLIC
          status: 'published',
          revision: revisionId,
          // biome-ignore lint: minimal IPage shape sufficient for the dispatcher
        } as any,
        revisionId: revisionId.toString(),
      });
    });
    await Promise.all(updates);

    // Wait for one coalesce window + buffer.
    await new Promise((r) => setTimeout(r, 1500));

    const docs = await db()
      .collection('vault_instructions')
      .find(namespaceFilter)
      .toArray();
    const bulkUpserts = docs.filter((d) => d.op === 'bulk-upsert').length;
    const upserts = docs.filter((d) => d.op === 'upsert').length;

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
    const parentPath = '/vault-e2e-null-rev';
    const orphanFilename = 'vault-e2e-null-rev.md';

    // Simulate GROWI's intermediate-page auto-generation by inserting a
    // page document with no revision.
    await db().collection('pages').insertOne({
      path: parentPath,
      status: 'published',
      grant: 1, // GRANT_PUBLIC
      revision: null,
    });

    // Re-run the bootstrap so it sees the new page.
    await setBootstrapState('pending');
    const { bootstrapper } = getVaultE2eHandle();
    await bootstrapper.start({ triggerSource: 'admin-ui' });

    // Poll until bootstrap completes. Sequential await is intentional.
    const deadline = Date.now() + 30_000;
    let lastState = '';
    while (Date.now() < deadline) {
      // biome-ignore lint: poll-and-back-off pattern
      const doc = await db()
        .collection('vault_sync_state')
        .findOne({ _id: 'singleton' as unknown as never });
      lastState = (doc?.bootstrapState as string | undefined) ?? '';
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
});
