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
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type IPage, PageGrant } from '@growi/core';
import mongoose from 'mongoose';
import { afterAll, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { PageUpdateManyEventExtras } from '~/server/events/page';

import { getVaultE2eHandle } from '../../../../test/setup/vault-e2e';
import {
  createVaultDescendantsRenameHandler,
  type RenamedDescendant,
} from '../server/services/vault-descendants-rename-handler';
import { vaultNamespaceMapper } from '../server/services/vault-namespace-mapper';
import { createVaultPageUpdateHandler } from '../server/services/vault-page-update-handler';
import { VAULT_E2E_CONFIG, VAULT_E2E_PAGES } from './fixture-contract';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vaultRepoUrl = (): string => `${VAULT_E2E_CONFIG.baseUrl}/vault.git`;

/** Clone with the PAT as URL credentials; git sends them after the gateway's 401 challenge. */
async function cloneAuthenticated(pat: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'growi-vault-clone-'));
  const url = new URL(vaultRepoUrl());
  url.username = 'x';
  url.password = pat;
  await execFileAsync('git', ['clone', url.toString(), dir], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
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
    const beforeDir = await cloneAuthenticated(VAULT_E2E_CONFIG.admin.pat);
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
    const afterDir = await cloneAuthenticated(VAULT_E2E_CONFIG.admin.pat);
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
  // Contract: when a single public page becomes "only me", it disappears
  // from the clone of everyone except the granted user — including the
  // page's creator when someone else was granted.
  // ----------------------------------------------------------------------
  it("single-page grant change to only-me removes the file from every clone but the granted user's", async () => {
    const pageId = new mongoose.Types.ObjectId();
    const revisionId = new mongoose.Types.ObjectId();
    const path = '/vault-e2e-grant-change/page';
    const file = 'vault-e2e-grant-change/page.md';
    const creatorId = new mongoose.Types.ObjectId(
      VAULT_E2E_CONFIG.admin.userId,
    );
    const grantedUserId = new mongoose.Types.ObjectId(
      VAULT_E2E_CONFIG.member.userId,
    );

    await db().collection('revisions').insertOne({
      _id: revisionId,
      body: '# grant change target\nsentinel:grant-change\n',
      pageId,
    });

    const onlyMeGrantState = {
      grant: PageGrant.GRANT_OWNER,
      grantedGroups: [],
      grantedUsers: [grantedUserId],
    };

    const { dispatcher } = getVaultE2eHandle();
    const handlePageUpdate = createVaultPageUpdateHandler(
      dispatcher,
      vaultNamespaceMapper,
      // The page is never stored; the grant-changing update reads this back.
      async () => onlyMeGrantState,
    );
    const pageWith = (
      grantState: Pick<IPage, 'grant' | 'grantedUsers'>,
    ): Parameters<typeof handlePageUpdate>[0] =>
      mock<Parameters<typeof handlePageUpdate>[0]>({
        _id: pageId,
        path,
        status: 'published',
        revision: revisionId,
        creator: creatorId,
        grantedGroups: [],
        ...grantState,
      });
    const cloneHasFile = async (pat: string): Promise<boolean> => {
      const dir = await cloneAuthenticated(pat);
      tmpDirs.push(dir);
      return (await listFiles(dir)).includes(file);
    };
    // vault-manager applies instructions asynchronously (and plain upserts
    // first sit in the coalesce buffer), so clone until the state is reached.
    const expectCloneEventually = async (
      pat: string,
      expected: 'has the file' | 'lacks the file',
    ): Promise<void> => {
      await expect
        .poll(() => cloneHasFile(pat), { timeout: 30_000, interval: 500 })
        .toBe(expected === 'has the file');
    };

    await handlePageUpdate(
      pageWith({ grant: PageGrant.GRANT_PUBLIC, grantedUsers: [] }),
    );

    await expectCloneEventually(VAULT_E2E_CONFIG.admin.pat, 'has the file');

    await handlePageUpdate(pageWith(onlyMeGrantState), {
      previousGrant: PageGrant.GRANT_PUBLIC,
      previousGrantedGroups: [],
      previousGrantedUsers: [],
    });

    await expectCloneEventually(VAULT_E2E_CONFIG.admin.pat, 'lacks the file');
    await expectCloneEventually(VAULT_E2E_CONFIG.member.pat, 'has the file');
  });

  // ----------------------------------------------------------------------
  // Contract: renaming a page with descendants relocates the descendant
  // files in the clone. The handler is fed what PageService emits: one
  // 'updateMany' per batch of descendants, all carrying the same operation.
  // ----------------------------------------------------------------------
  describe('descendant rename', () => {
    type SeededPage = RenamedDescendant & {
      readonly body: string;
      readonly revision: mongoose.Types.ObjectId;
    };

    /** Publishes public pages and waits until the admin clone has their files. */
    const seedPublicPages = async (
      paths: readonly string[],
    ): Promise<SeededPage[]> => {
      const pages = paths.map((path) => ({
        _id: new mongoose.Types.ObjectId(),
        revision: new mongoose.Types.ObjectId(),
        path,
        body: `# ${path}\n`,
        grant: PageGrant.GRANT_PUBLIC,
        grantedGroups: [],
        grantedUsers: [],
      }));
      await db()
        .collection('revisions')
        .insertMany(
          pages.map((p) => ({ _id: p.revision, body: p.body, pageId: p._id })),
        );
      const { dispatcher } = getVaultE2eHandle();
      await Promise.all(
        pages.map((page) =>
          dispatcher.onPageChanged({
            type: 'update',
            page,
            revisionId: page.revision.toString(),
          }),
        ),
      );
      await expect
        .poll(async () => adminCloneFiles(), { timeout: 30_000, interval: 500 })
        .toEqual(expect.arrayContaining(paths.map(mappedFile)));
      return pages;
    };

    const mappedFile = (path: string): string => `${path.slice(1)}.md`;

    const adminCloneFiles = async (): Promise<string[]> => {
      const dir = await cloneAuthenticated(VAULT_E2E_CONFIG.admin.pat);
      tmpDirs.push(dir);
      return listFiles(dir);
    };

    const adminCloneAfterDrain = async (): Promise<{
      files: string[];
      read: (file: string) => Promise<string>;
    }> => {
      await waitForInstructionsDrained(30_000);
      const dir = await cloneAuthenticated(VAULT_E2E_CONFIG.admin.pat);
      tmpDirs.push(dir);
      return {
        files: await listFiles(dir),
        read: (file) => readFile(join(dir, file), 'utf-8'),
      };
    };

    /** Emits the descendants one per batch, as one rename operation. */
    const renameDescendantsInBatches = async (
      descendants: readonly SeededPage[],
      oldPagePathPrefix: string,
      newPagePathPrefix: string,
    ): Promise<void> => {
      const handleDescendantsRenamed = createVaultDescendantsRenameHandler(
        getVaultE2eHandle().dispatcher,
        vaultNamespaceMapper,
      );
      const rename: PageUpdateManyEventExtras = {
        scope: 'subtree',
        oldPagePathPrefix,
        newPagePathPrefix,
        operation: {},
      };
      for (const page of descendants) {
        // biome-ignore lint/performance/noAwaitInLoops: batches arrive one after another
        await handleDescendantsRenamed([page], rename);
      }
    };

    it('moves every descendant file to the new directory with its body unchanged', async () => {
      const descendants = await seedPublicPages([
        '/vault-e2e-subtree/a/x',
        '/vault-e2e-subtree/a/deep/y',
      ]);

      await renameDescendantsInBatches(
        descendants,
        '/vault-e2e-subtree/a',
        '/vault-e2e-subtree/c',
      );

      const clone = await adminCloneAfterDrain();
      expect(clone.files).not.toContain('vault-e2e-subtree/a/x.md');
      expect(clone.files).not.toContain('vault-e2e-subtree/a/deep/y.md');
      expect(await clone.read('vault-e2e-subtree/c/x.md')).toBe(
        descendants[0].body,
      );
      expect(await clone.read('vault-e2e-subtree/c/deep/y.md')).toBe(
        descendants[1].body,
      );
    });

    it('keeps the files already in the destination directory', async () => {
      const [existing, ...descendants] = await seedPublicPages([
        '/vault-e2e-merge/c/existing',
        '/vault-e2e-merge/a/x',
      ]);

      await renameDescendantsInBatches(
        descendants,
        '/vault-e2e-merge/a',
        '/vault-e2e-merge/c',
      );

      const clone = await adminCloneAfterDrain();
      expect(await clone.read('vault-e2e-merge/c/existing.md')).toBe(
        existing.body,
      );
      expect(await clone.read('vault-e2e-merge/c/x.md')).toBe(
        descendants[0].body,
      );
    });

    it('renames a page under itself without nesting its files any deeper', async () => {
      const [renamedPage, ...descendants] = await seedPublicPages([
        '/vault-e2e-nest/a',
        '/vault-e2e-nest/a/x',
        '/vault-e2e-nest/a/y',
      ]);

      // PageService emits 'rename' for the page itself before it renames
      // the descendants.
      await getVaultE2eHandle().dispatcher.onPageRenamed({
        page: renamedPage,
        oldPath: '/vault-e2e-nest/a',
        newPath: '/vault-e2e-nest/a/b',
        revisionId: renamedPage.revision.toString(),
      });
      await renameDescendantsInBatches(
        descendants,
        '/vault-e2e-nest/a',
        '/vault-e2e-nest/a/b',
      );

      const clone = await adminCloneAfterDrain();
      expect(
        clone.files.filter((f) => f.startsWith('vault-e2e-nest/')).sort(),
      ).toEqual([
        'vault-e2e-nest/a/b.md',
        'vault-e2e-nest/a/b/x.md',
        'vault-e2e-nest/a/b/y.md',
      ]);
    });
  });

  // ----------------------------------------------------------------------
  // Contract: the gateway authenticates against the PAT supplied in HTTP
  // Basic Auth. An invalid PAT must yield 401.
  //
  // We probe the HTTP layer directly: the vault contract is
  // "Authorization: Basic <bad-pat> → 401", while a failing `git clone`
  // would only show how the git client reports it.
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
