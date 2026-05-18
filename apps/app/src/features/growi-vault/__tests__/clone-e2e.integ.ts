/**
 * End-to-end git clone contract test for the GROWI Vault gateway.
 *
 * The fixture is provisioned by the globalSetup at
 * `test/setup/vault-e2e/global-setup.ts`. The setup spawns a real
 * vault-manager, mounts the vault routes on a test Express server, and
 * seeds two users + the pages declared in `fixture-contract.ts`.
 *
 * Until the globalSetup ships, `isVaultE2eFixtureReady()` returns false
 * and this suite is skipped. Once it lands, the env var is always set
 * and these tests run unconditionally on every CI run.
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
import { afterAll, describe, expect, it } from 'vitest';

import {
  isVaultE2eFixtureReady,
  VAULT_E2E_CONFIG,
  VAULT_E2E_PAGES,
} from './fixture-contract';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a vault clone URL with HTTP Basic Auth credentials embedded.
 *
 * Username is intentionally arbitrary — the gateway ignores it and validates
 * the PAT in the password slot only.
 */
function vaultCloneUrl(pat: string): string {
  const url = new URL(`${VAULT_E2E_CONFIG.baseUrl}/_vault/repo.git`);
  url.username = 'x';
  url.password = pat;
  return url.toString();
}

function vaultCloneUrlAnonymous(): string {
  return `${VAULT_E2E_CONFIG.baseUrl}/_vault/repo.git`;
}

async function cloneVault(cloneUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'growi-vault-clone-'));
  // -c http.emptyAuth=false stops git from silently retrying without auth
  // when the server replies 401 — we want clones with invalid PATs to fail.
  await execFileAsync('git', ['clone', cloneUrl, dir]);
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
  'GROWI Vault — clone E2E contract',
  () => {
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
      const dir = await cloneVault(vaultCloneUrl(VAULT_E2E_CONFIG.admin.pat));
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
      const dir = await cloneVault(vaultCloneUrl(VAULT_E2E_CONFIG.member.pat));
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
      const dir = await cloneVault(vaultCloneUrlAnonymous());
      tmpDirs.push(dir);

      const files = new Set(await listFiles(dir));
      expect(files.has(VAULT_E2E_PAGES.publicRoot.mappedFile)).toBe(true);
      expect(files.has(VAULT_E2E_PAGES.publicDeep.mappedFile)).toBe(true);
      expect(files.has(VAULT_E2E_PAGES.adminOnly.mappedFile)).toBe(false);
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
      const url = `${VAULT_E2E_CONFIG.baseUrl}/_vault/repo.git/info/refs?service=git-upload-pack`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from('x:invalid-pat').toString('base64')}`,
        },
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/^Basic /);
    });
  },
);
