import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deleteNamespace,
  ensureNamespaceHead,
  init,
  updateRef,
  writeCommit,
  writeTree,
} from './vault-repo-storage.js';

describe('deleteNamespace', () => {
  let root: string;
  let repoPath: string;
  let commitOid: string;

  const git = (...args: string[]): string =>
    execFileSync('git', ['--git-dir', repoPath, ...args], {
      encoding: 'utf8',
    });

  const listRefs = (): string => git('for-each-ref');

  const mainRef = (ns: string): string =>
    `refs/namespaces/${ns}/refs/heads/main`;

  const resolves = (ref: string): boolean => {
    try {
      git('rev-parse', '--verify', '--quiet', ref);
      return true;
    } catch {
      return false;
    }
  };

  const seedNamespace = async (ns: string): Promise<void> => {
    await updateRef(mainRef(ns), commitOid);
    await ensureNamespaceHead(ns);
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-storage-'));
    repoPath = path.join(root, 'repo.git');
    // The module resolves the repo path from the environment on first use.
    process.env.VAULT_REPO_PATH = repoPath;
    await init();
    const tree = await writeTree([]);
    const who = { name: 'test', email: 'test@example.com', timestamp: 0 };
    commitOid = await writeCommit({
      tree,
      parents: [],
      message: 'seed',
      author: who,
      committer: who,
    });
  }, 30_000);

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes a loose ref and the namespace HEAD file', async () => {
    await seedNamespace('loose-ns');

    await deleteNamespace('loose-ns');

    expect(resolves(mainRef('loose-ns'))).toBe(false);
    expect(listRefs()).not.toContain('refs/namespaces/loose-ns/');
    expect(
      fs.existsSync(path.join(repoPath, 'refs', 'namespaces', 'loose-ns')),
    ).toBe(false);
  });

  it('removes a ref that exists only in packed-refs', async () => {
    await seedNamespace('packed-ns');
    git('pack-refs', '--all');
    expect(fs.existsSync(path.join(repoPath, mainRef('packed-ns')))).toBe(
      false,
    );
    expect(resolves(mainRef('packed-ns'))).toBe(true);

    await deleteNamespace('packed-ns');

    expect(resolves(mainRef('packed-ns'))).toBe(false);
    expect(listRefs()).not.toContain('refs/namespaces/packed-ns/');
    expect(
      fs.existsSync(path.join(repoPath, 'refs', 'namespaces', 'packed-ns')),
    ).toBe(false);
  });

  it.each([
    { label: 'loose', pack: false },
    { label: 'packed', pack: true },
  ])('keeps other namespaces and sparse-filter refs ($label)', async ({
    pack,
  }) => {
    await seedNamespace('target-ns');
    await seedNamespace('other-ns');
    await updateRef('refs/vault/sparse-filters/exclude-user-pages', commitOid);
    if (pack) {
      git('pack-refs', '--all');
    }

    await deleteNamespace('target-ns');

    expect(resolves(mainRef('target-ns'))).toBe(false);
    expect(resolves(mainRef('other-ns'))).toBe(true);
    expect(resolves('refs/vault/sparse-filters/exclude-user-pages')).toBe(true);
    expect(
      fs.readFileSync(
        path.join(repoPath, 'refs', 'namespaces', 'other-ns', 'HEAD'),
        'utf8',
      ),
    ).toContain('refs/namespaces/other-ns/refs/heads/main');
  });

  it('resolves without error and changes nothing for a namespace that does not exist', async () => {
    await seedNamespace('bystander-ns');
    const before = listRefs();

    await expect(deleteNamespace('absent-ns')).resolves.toBeUndefined();

    expect(listRefs()).toBe(before);
    expect(resolves(mainRef('bystander-ns'))).toBe(true);
  });
});
