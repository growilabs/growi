import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  findUnsupportedFilters,
  installSparseFilters,
  PUBLISHED_SPARSE_FILTERS,
  sparseFilterOid,
  sparseFilterRefPath,
} from './vault-sparse-filter.js';

const execFileAsync = promisify(execFile);

const EXCLUDE_USER_PAGES = PUBLISHED_SPARSE_FILTERS[0];
if (EXCLUDE_USER_PAGES == null) {
  throw new Error('no sparse filter is published');
}

// ---------------------------------------------------------------------------
// sparseFilterOid
// ---------------------------------------------------------------------------

describe('sparseFilterOid', () => {
  /**
   * The object name is what the client puts in `--filter=sparse:oid=<oid>`, so
   * it has to be the name git itself gives those bytes — anything else and the
   * filter names an object the repository does not hold. Compared against real
   * git rather than a golden constant, since git is the definition here.
   */
  it('gives the patterns the same object name git does', () => {
    // execFileSync, because only the sync form can feed stdin in one call.
    const fromGit = execFileSync(
      'git',
      ['hash-object', '-t', 'blob', '--stdin'],
      {
        input: EXCLUDE_USER_PAGES.patterns,
        encoding: 'utf8',
      },
    );

    expect(sparseFilterOid(EXCLUDE_USER_PAGES)).toBe(fromGit.trim());
  });

  it('is the object name the README tells clients to pass', () => {
    // The object name is content-addressed, so editing a spec's patterns
    // silently invalidates every documented clone command. This is the drift
    // check for that: change the patterns and the README has to change too.
    const readme = fs.readFileSync(
      path.join(import.meta.dirname, '../../README.md'),
      'utf8',
    );

    expect(readme).toContain(
      `--filter=sparse:oid=${sparseFilterOid(EXCLUDE_USER_PAGES)}`,
    );
  });

  it('gives different patterns different names', () => {
    expect(sparseFilterOid({ name: 'a', patterns: '/*\n' })).not.toBe(
      sparseFilterOid({ name: 'a', patterns: '/*\n!/user\n' }),
    );
  });
});

// ---------------------------------------------------------------------------
// findUnsupportedFilters
// ---------------------------------------------------------------------------

describe('findUnsupportedFilters', () => {
  const publishedOid = sparseFilterOid(EXCLUDE_USER_PAGES);
  const find = (filters: readonly string[]): readonly string[] =>
    findUnsupportedFilters(filters, PUBLISHED_SPARSE_FILTERS);

  it('has nothing to refuse when the request carries no filter', () => {
    expect(find([])).toEqual([]);
  });

  it('serves a filter that names a published spec', () => {
    expect(find([`sparse:oid=${publishedOid}`])).toEqual([]);
  });

  it('refuses blob:none, whose deferred file bodies are fetched one object at a time later', () => {
    // The clone itself would succeed and the checkout would then fail, which is
    // a worse outcome than refusing the filter up front.
    expect(find(['blob:none'])).toEqual(['blob:none']);
  });

  it('refuses blob:limit, tree and object:type filters for the same reason', () => {
    expect(find(['blob:limit=1k'])).toEqual(['blob:limit=1k']);
    expect(find(['tree:0'])).toEqual(['tree:0']);
    expect(find(['object:type=blob'])).toEqual(['object:type=blob']);
  });

  it('refuses a combined filter even when one half names a published spec', () => {
    const combined = `combine:sparse:oid=${publishedOid}+blob:none`;

    expect(find([combined])).toEqual([combined]);
  });

  it('refuses a sparse:oid that names an object the server did not publish', () => {
    // Otherwise a client could point the filter at any object it knows the name
    // of, and read something back out of which paths the server then serves.
    const foreign = `sparse:oid=${'a'.repeat(40)}`;

    expect(find([foreign])).toEqual([foreign]);
  });

  it('refuses a sparse:path filter, which git dropped and this server never served', () => {
    expect(find(['sparse:path=/etc/passwd'])).toEqual([
      'sparse:path=/etc/passwd',
    ]);
  });

  it('reports every offending filter when a request carries several', () => {
    expect(find([`sparse:oid=${publishedOid}`, 'blob:none', 'tree:0'])).toEqual(
      ['blob:none', 'tree:0'],
    );
  });
});

// ---------------------------------------------------------------------------
// installSparseFilters
// ---------------------------------------------------------------------------

/**
 * Runs against a real bare repository: what has to hold is that upload-pack can
 * still resolve the published object name after a pruning gc, and only git can
 * answer that.
 */
describe('installSparseFilters', () => {
  let root: string;
  let repoPath: string;

  const gitInRepo = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args]);
    return stdout.trim();
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-sparse-filter-'));
    repoPath = path.join(root, 'repo.git');
    await execFileAsync('git', ['init', '--bare', '-q', repoPath]);
    // vault-repo-storage resolves the repo path from the environment on first
    // use, so this has to be set before any of its functions run.
    process.env.VAULT_REPO_PATH = repoPath;
  }, 30_000);

  afterAll(() => {
    if (root != null) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stores each published spec under its own ref, holding the patterns git will read', async () => {
    await installSparseFilters(PUBLISHED_SPARSE_FILTERS);

    for (const spec of PUBLISHED_SPARSE_FILTERS) {
      // biome-ignore lint/performance/noAwaitInLoops: each spec is checked against the same repository, one git call at a time
      const oid = await gitInRepo('rev-parse', sparseFilterRefPath(spec.name));
      expect(oid).toBe(sparseFilterOid(spec));

      const stored = await execFileAsync('git', [
        '-C',
        repoPath,
        'cat-file',
        '-p',
        oid,
      ]);
      expect(stored.stdout).toBe(spec.patterns);
    }
  }, 30_000);

  it('keeps the spec reachable through a pruning gc, so the published object name stays resolvable', async () => {
    await installSparseFilters(PUBLISHED_SPARSE_FILTERS);
    const oid = sparseFilterOid(EXCLUDE_USER_PAGES);

    await gitInRepo('gc', '--prune=now', '-q');

    expect(await gitInRepo('cat-file', '-t', oid)).toBe('blob');
  }, 60_000);

  it('can be run again on a repository that already has the specs', async () => {
    await installSparseFilters(PUBLISHED_SPARSE_FILTERS);
    await installSparseFilters(PUBLISHED_SPARSE_FILTERS);

    expect(
      await gitInRepo(
        'rev-parse',
        sparseFilterRefPath(EXCLUDE_USER_PAGES.name),
      ),
    ).toBe(sparseFilterOid(EXCLUDE_USER_PAGES));
  }, 30_000);
});
