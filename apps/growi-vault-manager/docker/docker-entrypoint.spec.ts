import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chownRecursive,
  dropPrivileges,
  ensureRepoDir,
  resolveRepoPath,
} from './docker-entrypoint';

describe('resolveRepoPath', () => {
  it('returns VAULT_REPO_PATH when set', () => {
    expect(resolveRepoPath({ VAULT_REPO_PATH: '/custom/repo.git' })).toBe(
      '/custom/repo.git',
    );
  });

  it('falls back to the shared-volume default when unset', () => {
    // This default MUST equal resolveRepoPath() in services/vault-repo-storage.ts.
    // If they diverge, the entrypoint chowns a different directory than the one
    // the app writes to, and the privilege drop silently breaks /data sharing.
    expect(resolveRepoPath({})).toBe('/data/vault-repo.git');
  });

  it('falls back to the default when set but empty', () => {
    expect(resolveRepoPath({ VAULT_REPO_PATH: '' })).toBe(
      '/data/vault-repo.git',
    );
  });
});

describe('chownRecursive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-entrypoint-chown-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('chowns nested directories and files recursively', () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');
    fs.writeFileSync(path.join(subDir, 'file2.txt'), 'world');

    const chowned: string[] = [];
    // chown to a non-current uid would EPERM for a non-root test runner, so the
    // syscall is stubbed; the contract under test is "every entry is handed over".
    vi.spyOn(fs, 'chownSync').mockImplementation((p) => {
      chowned.push(p as string);
    });

    chownRecursive(tmpDir, 1000, 1000);

    expect(chowned).toEqual(
      expect.arrayContaining([
        tmpDir,
        subDir,
        path.join(tmpDir, 'file1.txt'),
        path.join(subDir, 'file2.txt'),
      ]),
    );
    expect(chowned).toHaveLength(4);
  });
});

describe('ensureRepoDir', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-entrypoint-repo-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates the bare-repo directory when it does not exist', () => {
    const repoPath = path.join(tmpRoot, 'data', 'vault-repo.git');
    vi.spyOn(fs, 'chownSync').mockImplementation(() => {});

    expect(fs.existsSync(repoPath)).toBe(false);
    ensureRepoDir(repoPath);
    expect(fs.existsSync(repoPath)).toBe(true);
  });

  it('hands the directory to the node user (uid/gid 1000)', () => {
    const repoPath = path.join(tmpRoot, 'data', 'vault-repo.git');
    const chownSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});

    ensureRepoDir(repoPath);

    expect(chownSpy).toHaveBeenCalledWith(repoPath, 1000, 1000);
  });

  it('reclaims an existing repo left behind by a previous root-era run', () => {
    const repoPath = path.join(tmpRoot, 'data', 'vault-repo.git');
    fs.mkdirSync(repoPath, { recursive: true });
    fs.writeFileSync(path.join(repoPath, 'HEAD'), 'ref: refs/heads/main\n');
    const chownSpy = vi.spyOn(fs, 'chownSync').mockImplementation(() => {});

    expect(() => ensureRepoDir(repoPath)).not.toThrow();
    expect(fs.existsSync(repoPath)).toBe(true);
    // Existing contents must also be reassigned to node, not just the dir itself.
    expect(chownSpy).toHaveBeenCalledWith(
      path.join(repoPath, 'HEAD'),
      1000,
      1000,
    );
  });
});

describe('dropPrivileges', () => {
  const originalSetgid = process.setgid;
  const originalSetuid = process.setuid;

  afterEach(() => {
    process.setgid = originalSetgid;
    process.setuid = originalSetuid;
  });

  it('drops to gid 1000 then uid 1000, in that order', () => {
    // The real syscalls are replaced so the test runner's own uid is never
    // changed; order matters because setuid is irreversible for gid changes.
    const order: string[] = [];
    process.setgid = (id) => {
      order.push(`gid=${String(id)}`);
    };
    process.setuid = (id) => {
      order.push(`uid=${String(id)}`);
    };

    dropPrivileges();

    expect(order).toEqual(['gid=1000', 'uid=1000']);
  });

  it('throws when privilege-drop APIs are unavailable (non-POSIX)', () => {
    process.setgid = undefined;
    process.setuid = undefined;

    expect(() => dropPrivileges()).toThrow(/not available/);
  });
});
