/**
 * End-to-end git clone contract test for the GROWI Vault gateway.
 *
 * The fixture is provisioned once per run by `test/setup/vault-e2e/index.ts`,
 * which spawns vault-manager, mounts the gateway router on an Express server,
 * and seeds two users + the pages declared in `fixture-contract.ts`.
 *
 * The assertions below intentionally encode observable contracts only:
 *  - HTTP status codes returned by the gateway
 *  - Exact file contents at deterministic mapped paths
 *  - Presence / absence of files based on ACL
 *
 * They do NOT assert on:
 *  - "any markdown file exists" (fixture-dependent generic check)
 *  - Filenames the implementation never produces (e.g. 'root.md')
 *  - git's auth-fallback behaviour (this is a git client property,
 *    not a vault gateway contract — verified at the HTTP layer below)
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';

import { getVaultE2eHandle } from '../../../../test/setup/vault-e2e';
import { VAULT_E2E_CONFIG, VAULT_E2E_PAGES } from './fixture-contract';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vaultRepoUrl = (): string => `${VAULT_E2E_CONFIG.baseUrl}/vault.git`;

/**
 * Clone the vault repo with an explicit Authorization header.
 *
 * git's default behaviour is to issue the first `/info/refs` request WITHOUT
 * credentials and only retry with credentials if the server returns 401.
 * Because our gateway intentionally allows anonymous access to the public
 * namespace, an unauthenticated probe succeeds — and git never sends the
 * credentials embedded in the URL.
 *
 * For the integration test we need every request to carry the PAT so the
 * gateway resolves the user, ACL filters the view, and the clone includes
 * the user's GRANT_OWNER pages. We inject the header via `http.extraheader`
 * which applies to every HTTP request issued by `git clone`.
 */
async function cloneAuthenticated(pat: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'growi-vault-clone-'));
  const auth = Buffer.from(`x:${pat}`).toString('base64');
  await execFileAsync('git', [
    '-c',
    `http.extraheader=Authorization: Basic ${auth}`,
    'clone',
    vaultRepoUrl(),
    dir,
  ]);
  return dir;
}

async function cloneAnonymous(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'growi-vault-clone-'));
  await execFileAsync('git', ['clone', vaultRepoUrl(), dir]);
  return dir;
}

async function listFiles(repoDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, 'ls-files']);
  return stdout.trim().split('\n').filter(Boolean);
}

function db(): import('mongodb').Db {
  const conn = mongoose.connection.db;
  if (conn == null) {
    throw new Error(
      'mongoose connection not established. The vault E2E setup must run before these tests.',
    );
  }
  return conn;
}

/**
 * Wait until vault-manager has drained the outbox (no unprocessed
 * vault_instructions remain). The apps/app dispatcher only WRITES the
 * instructions; vault-manager applies them asynchronously via its change
 * stream, so the cloned tree only reflects them after the outbox is empty.
 */
async function waitForInstructionsDrained(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let pending = -1;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: poll-and-back-off pattern
    pending = await db()
      .collection('vault_instructions')
      .countDocuments({ processedAt: null });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `vault-manager did not drain vault_instructions within ${timeoutMs}ms (${pending} still pending)`,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GROWI Vault — clone E2E contract', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(
      tmpDirs.map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  // ----------------------------------------------------------------------
  // Contract: a clone with the admin PAT returns exactly the bodies the
  // fixture seeded for every accessible page.
  //
  // This catches:
  //   - Body corruption (truncation, encoding loss) in the blob pipeline.
  //   - Path-mapping regressions (file at the wrong location).
  //   - Bootstrap failures that leave the namespace tree incomplete.
  // ----------------------------------------------------------------------
  it('admin clone yields exact bodies for every fixture page', async () => {
    const dir = await cloneAuthenticated(VAULT_E2E_CONFIG.admin.pat);
    tmpDirs.push(dir);

    const files = new Set(await listFiles(dir));
    const pages = Object.values(VAULT_E2E_PAGES);

    for (const page of pages) {
      expect(
        files.has(page.mappedFile),
        `expected mapped file ${page.mappedFile} for page ${page.path}`,
      ).toBe(true);
    }

    const bodies = await Promise.all(
      pages.map((p) => readFile(join(dir, p.mappedFile), 'utf-8')),
    );
    pages.forEach((page, i) => {
      expect(bodies[i]).toBe(page.body);
    });
  });

  // ----------------------------------------------------------------------
  // Contract: the member user (no special grant on adminOnly) sees public
  // pages but NOT the GRANT_OWNER admin-only page.
  //
  // This is the headline security contract for ACL isolation in clones.
  // ----------------------------------------------------------------------
  it('member clone includes public pages and excludes admin-only page', async () => {
    const dir = await cloneAuthenticated(VAULT_E2E_CONFIG.member.pat);
    tmpDirs.push(dir);

    const files = new Set(await listFiles(dir));
    expect(files.has(VAULT_E2E_PAGES.publicRoot.mappedFile)).toBe(true);
    expect(files.has(VAULT_E2E_PAGES.publicDeep.mappedFile)).toBe(true);
    expect(files.has(VAULT_E2E_PAGES.adminOnly.mappedFile)).toBe(false);
  });

  // ----------------------------------------------------------------------
  // Contract: an anonymous clone returns the public namespace only —
  // never any page that requires authentication.
  // ----------------------------------------------------------------------
  it('anonymous clone includes public pages and excludes admin-only page', async () => {
    const dir = await cloneAnonymous();
    tmpDirs.push(dir);

    const files = new Set(await listFiles(dir));
    expect(files.has(VAULT_E2E_PAGES.publicRoot.mappedFile)).toBe(true);
    expect(files.has(VAULT_E2E_PAGES.publicDeep.mappedFile)).toBe(true);
    expect(files.has(VAULT_E2E_PAGES.adminOnly.mappedFile)).toBe(false);
  });

  // ----------------------------------------------------------------------
  // Contract: a single-page rename relocates the page's blob — the OLD
  // mapped file disappears and the NEW mapped file appears in the clone.
  //
  // Regression catch: this is the headline bug the fix addresses. A leaf
  // page is stored as a blob `<name>.md`; the previous implementation routed
  // a single-page rename through `rename-prefix` (a directory-subtree move),
  // which is a no-op on a blob — leaving the OLD file orphaned in the clone.
  // The fix routes single-page rename through `dispatcher.onPageRenamed`,
  // emitting remove(oldPath) + upsert(newPath) per namespace. This test
  // drives that exact entry point end-to-end and clones the result.
  // ----------------------------------------------------------------------
  it('single-page rename removes the old file and adds the new file in the clone', async () => {
    const pageId = new mongoose.Types.ObjectId();
    const revisionId = new mongoose.Types.ObjectId();
    const oldPath = '/vault-e2e-rename/before';
    const newPath = '/vault-e2e-rename/after';
    const oldFile = 'vault-e2e-rename/before.md';
    const newFile = 'vault-e2e-rename/after.md';
    const body = '# rename target\nsentinel:rename\n';

    // vault-manager reads the body from the revisions collection during
    // upsert processing — seed a revision document the upsert can resolve.
    await db()
      .collection('revisions')
      .insertOne({ _id: revisionId, body, pageId });

    const { dispatcher } = getVaultE2eHandle();

    // Step 1: create the page at the OLD path via a normal update event.
    await dispatcher.onPageChanged({
      type: 'update',
      page: {
        _id: pageId,
        path: oldPath,
        grant: 1, // GRANT_PUBLIC
        status: 'published',
        revision: revisionId,
        // biome-ignore lint/suspicious/noExplicitAny: minimal IPage shape sufficient for the dispatcher
      } as any,
      revisionId: revisionId.toString(),
    });
    // onPageChanged enqueues the upsert into the coalesce buffer; it is only
    // written to vault_instructions after COALESCE_WINDOW_MS. Wait past that
    // window before draining so the instruction has actually been emitted.
    await new Promise((r) => setTimeout(r, 1500));
    await waitForInstructionsDrained(30_000);

    // The old file must exist before the rename (guards against a false
    // positive where the assertion below passes only because nothing was
    // ever materialised).
    const beforeDir = await cloneAnonymous();
    tmpDirs.push(beforeDir);
    const beforeFiles = new Set(await listFiles(beforeDir));
    expect(beforeFiles.has(oldFile)).toBe(true);
    expect(beforeFiles.has(newFile)).toBe(false);

    // Step 2: rename the single page via the dedicated entry point. This is
    // what GROWI now calls for a leaf-page rename: it emits remove(oldPath) +
    // upsert(newPath) per namespace.
    await dispatcher.onPageRenamed({
      page: {
        _id: pageId,
        path: newPath,
        grant: 1, // GRANT_PUBLIC
        status: 'published',
        revision: revisionId,
        // biome-ignore lint/suspicious/noExplicitAny: minimal IPage shape sufficient for the dispatcher
      } as any,
      oldPath,
      newPath,
      revisionId: revisionId.toString(),
    });
    await waitForInstructionsDrained(30_000);
    // Allow the change-stream handler to finish applying both instructions to
    // the namespace ref before composing the post-rename view.
    await new Promise((r) => setTimeout(r, 500));

    // Step 3: clone again and assert the relocation took effect.
    const afterDir = await cloneAnonymous();
    tmpDirs.push(afterDir);
    const afterFiles = new Set(await listFiles(afterDir));

    expect(
      afterFiles.has(oldFile),
      `old file ${oldFile} must be removed after rename (was orphaned by the rename-prefix bug)`,
    ).toBe(false);
    expect(
      afterFiles.has(newFile),
      `new file ${newFile} must be present after rename`,
    ).toBe(true);

    // The relocated blob must carry the original body unchanged.
    const relocatedBody = await readFile(join(afterDir, newFile), 'utf-8');
    expect(relocatedBody).toBe(body);
  });

  // ----------------------------------------------------------------------
  // Contract: the gateway authenticates against the PAT supplied in HTTP
  // Basic Auth. An invalid PAT must yield 401.
  //
  // We probe the HTTP layer directly because `git clone` will silently
  // retry without credentials after a 401 — that's a git client property,
  // not a vault contract. The vault contract is "Authorization: Basic
  // <bad-pat> → 401".
  // ----------------------------------------------------------------------
  it('HTTP request with invalid PAT returns 401', async () => {
    const url = `${VAULT_E2E_CONFIG.baseUrl}/vault.git/info/refs?service=git-upload-pack`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from('x:invalid-pat').toString('base64')}`,
      },
      redirect: 'manual',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic /);
  });
});
