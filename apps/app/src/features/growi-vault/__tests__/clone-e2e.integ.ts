/**
 * E2E clone integration test.
 *
 * Requires docker-compose with apps/app + vault-manager + MongoDB running.
 * Run with: docker-compose up -d && pnpm vitest run clone-e2e.integ
 *
 * Environment variables:
 *   GROWI_TEST_URL  - Base URL of the running GROWI instance (default: http://localhost:3000)
 *   GROWI_TEST_PAT  - Personal Access Token of a test user with read access
 *   GROWI_TEST_PAT_PUBLIC - PAT of a user that has access only to public pages (optional)
 *   GROWI_TEST_USER - Username corresponding to GROWI_TEST_PAT (default: testuser)
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Configuration (resolved from environment at test start)
// ---------------------------------------------------------------------------

const BASE_URL = process.env.GROWI_TEST_URL ?? 'http://localhost:3000';
const TEST_PAT = process.env.GROWI_TEST_PAT ?? '';
const TEST_PAT_PUBLIC = process.env.GROWI_TEST_PAT_PUBLIC ?? '';
const TEST_USER = process.env.GROWI_TEST_USER ?? 'testuser';

/** Vault repository URL with embedded credentials. */
const vaultCloneUrl = (pat: string): string => {
  const url = new URL(`${BASE_URL}/_vault/repo.git`);
  url.username = TEST_USER;
  url.password = pat;
  return url.toString();
};

/** Vault repository URL without credentials (anonymous). */
const vaultCloneUrlAnonymous = (): string => `${BASE_URL}/_vault/repo.git`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clone the vault repository into a fresh temporary directory.
 * Returns the path to the cloned directory.
 */
async function cloneVault(cloneUrl: string): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'growi-vault-clone-'));
  await execFileAsync('git', ['clone', cloneUrl, tmpDir]);
  return tmpDir;
}

/**
 * Collect all file paths (relative to repoRoot) in the cloned repository,
 * excluding the .git directory.
 */
async function collectFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'ls-files']);
  return stdout.trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skip('GROWI Vault clone E2E (requires docker-compose)', () => {
  // Temporary directories created during tests; cleaned up in afterAll.
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(
      tmpDirs.map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  // --------------------------------------------------------------------------
  // Scenario 1: Successful clone with a valid PAT
  // --------------------------------------------------------------------------
  it('clones the vault repository with a valid PAT', async () => {
    // Prerequisite: GROWI_TEST_PAT must be set.
    expect(TEST_PAT, 'GROWI_TEST_PAT must be set').toBeTruthy();

    const cloneDir = await cloneVault(vaultCloneUrl(TEST_PAT));
    tmpDirs.push(cloneDir);

    // The cloned directory must be a valid git repository (HEAD exists).
    const { stdout: head } = await execFileAsync('git', [
      '-C',
      cloneDir,
      'rev-parse',
      'HEAD',
    ]);
    expect(head.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Cloned file list matches expected page structure
  // --------------------------------------------------------------------------
  it('clone result contains expected page files', async () => {
    expect(TEST_PAT, 'GROWI_TEST_PAT must be set').toBeTruthy();

    const cloneDir = await cloneVault(vaultCloneUrl(TEST_PAT));
    tmpDirs.push(cloneDir);

    const files = await collectFiles(cloneDir);

    // At minimum, one Markdown file must exist — the wiki is not empty.
    const markdownFiles = files.filter((f) => f.endsWith('.md'));
    expect(markdownFiles.length).toBeGreaterThan(0);

    // Each tracked file should be readable and non-empty.
    for (const file of markdownFiles.slice(0, 5)) {
      const content = await readFile(join(cloneDir, file), 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Content of a known page is correct
  // --------------------------------------------------------------------------
  it('clone result contains the expected content of a known public page', async () => {
    expect(TEST_PAT, 'GROWI_TEST_PAT must be set').toBeTruthy();

    const cloneDir = await cloneVault(vaultCloneUrl(TEST_PAT));
    tmpDirs.push(cloneDir);

    const files = await collectFiles(cloneDir);

    // Expect the root page to be present.
    // The exact filename depends on the namespace mapping (e.g. "root.md" or "index.md").
    // Adjust to match the actual mapping implemented in VaultNamespaceMapper.
    const rootPageCandidates = files.filter(
      (f) => f === 'root.md' || f === 'index.md' || f === '_root.md',
    );
    expect(
      rootPageCandidates.length,
      'Root page file must exist in clone',
    ).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Anonymous clone returns only public pages
  // --------------------------------------------------------------------------
  it('anonymous clone returns only public pages', async () => {
    // This scenario exercises the ACL filter in VaultNamespaceMapper when no
    // user is authenticated.  The cloned file set must not include pages that
    // are restricted to specific users or groups.

    // Attempt an unauthenticated clone.  If the server requires credentials it
    // returns a 401 and git exits with a non-zero code.  In that case we skip
    // rather than fail (whether anonymous access is allowed is a site setting).
    let cloneDir: string;
    try {
      cloneDir = await cloneVault(vaultCloneUrlAnonymous());
    } catch {
      // Anonymous clone rejected by the server — this is acceptable.
      return;
    }
    tmpDirs.push(cloneDir);

    const anonFiles = await collectFiles(cloneDir);

    if (TEST_PAT) {
      // If a PAT clone is also possible, it must return a superset of the
      // anonymous clone's files (i.e. anonFiles ⊆ patFiles).
      const patDir = await cloneVault(vaultCloneUrl(TEST_PAT));
      tmpDirs.push(patDir);
      const patFiles = await collectFiles(patDir);
      const patFileSet = new Set(patFiles);

      for (const f of anonFiles) {
        expect(
          patFileSet.has(f),
          `File ${f} from anon clone must also appear in PAT clone`,
        ).toBe(true);
      }
    }

    // Anonymous clone must not contain files from private namespaces.
    // Private page paths are project-specific; the assertion below checks
    // that no file path contains the sentinel "/private/" used in the test
    // fixture (adjust to match the actual test data).
    const privateFiles = anonFiles.filter((f) => f.includes('/private/'));
    expect(
      privateFiles,
      'Anonymous clone must not include private namespace files',
    ).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Clone with an invalid PAT returns 401
  // --------------------------------------------------------------------------
  it('clone with an invalid PAT fails with an authentication error', async () => {
    await expect(
      cloneVault(vaultCloneUrl('invalid-pat-token')),
    ).rejects.toThrow();
  });
});
