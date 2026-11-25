import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));

vi.mock('@growi/logger', () => ({
  loggerFactory: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  }),
}));

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const REF_A = 'refs/namespaces/public/refs/heads/main';
const REF_B = 'refs/namespaces/group-g1/refs/heads/main';
const REF_FILTER = 'refs/vault/sparse-filters/pages-only';

let repoPath: string;
let storage: typeof import('./vault-repo-storage.js');

function writePackedRefs(lines: string[]): void {
  fs.writeFileSync(
    path.join(repoPath, 'packed-refs'),
    `${['# pack-refs with: peeled fully-peeled sorted ', ...lines].join('\n')}\n`,
  );
}

function runGit(...args: string[]): string {
  return execFileSync('git', ['--git-dir', repoPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hasObject(oid: string): boolean {
  try {
    runGit('cat-file', '-e', oid);
    return true;
  } catch {
    return false;
  }
}

function looseObjectPath(oid: string): string {
  return path.join(repoPath, 'objects', oid.slice(0, 2), oid.slice(2));
}

/** Makes a loose object look as if it was written three weeks ago. */
function ageLooseObject(oid: string): void {
  const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
  fs.utimesSync(looseObjectPath(oid), threeWeeksAgo, threeWeeksAgo);
}

/** The gc the maintenance scheduler runs. */
function runProductionGc(): void {
  runGit('-c', 'gc.packRefs=false', 'gc', '--prune=2.weeks.ago');
}

const BOT = { name: 'bot', email: 'bot@example.com', timestamp: 1_700_000_000 };

function looseRef(ref: string): string | null {
  const file = path.join(repoPath, ref);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}

beforeAll(async () => {
  repoPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'vault-repo-storage-spec-')),
    'repo.git',
  );
  // The repo path is resolved from the environment once, at first use.
  vi.stubEnv('VAULT_REPO_PATH', repoPath);
  storage = await import('./vault-repo-storage.js');
  await storage.init();
});

afterAll(() => {
  fs.rmSync(path.dirname(repoPath), { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(path.join(repoPath, 'packed-refs'), { force: true });
  for (const dir of ['namespaces', 'vault']) {
    fs.rmSync(path.join(repoPath, 'refs', dir), {
      recursive: true,
      force: true,
    });
  }
});

describe('a repository with packed-refs', () => {
  it('init() logs an error that asks for a rebuild and leaves the refs as they are', async () => {
    writePackedRefs([`${OID_A} ${REF_A}`]);

    await storage.init();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringMatching(/Rebuild Vault/),
    );
    expect(looseRef(REF_A)).toBeNull();
    expect(fs.existsSync(path.join(repoPath, 'packed-refs'))).toBe(true);
  });

  it('readRef refuses to read a ref that has no loose file', async () => {
    writePackedRefs([`${OID_A} ${REF_A}`]);

    await expect(storage.readRef(REF_A)).rejects.toThrow(/Rebuild Vault/);
  });

  it('readRef refuses to read a ref even when it has a loose file', async () => {
    // A write after an old gc may have left a loose ref holding a truncated
    // namespace next to its packed entry; only a rebuild repairs it.
    await storage.updateRef(REF_A, OID_A);
    writePackedRefs([`${OID_B} ${REF_A}`]);

    await expect(storage.readRef(REF_A)).rejects.toThrow(/Rebuild Vault/);
  });

  it('readRef refuses to read a ref when it cannot tell whether packed-refs exists', async () => {
    await storage.updateRef(REF_A, OID_A);
    // A self-referencing symlink fails every lookup with ELOOP, not ENOENT.
    fs.symlinkSync('packed-refs', path.join(repoPath, 'packed-refs'));

    await expect(storage.readRef(REF_A)).rejects.toThrow(/ELOOP/);
  });

  it('dropPackedNamespaceRefs() drops packed namespace refs and keeps the others loose', async () => {
    writePackedRefs([
      `${OID_A} ${REF_A}`,
      `^${OID_C}`,
      `${OID_B} ${REF_B}`,
      `${OID_C} ${REF_FILTER}`,
    ]);

    await storage.dropPackedNamespaceRefs();

    expect(await storage.readRef(REF_A)).toBeNull();
    expect(await storage.readRef(REF_B)).toBeNull();
    expect(await storage.readRef(REF_FILTER)).toBe(OID_C);
  });

  it('dropPackedNamespaceRefs() keeps a loose ref outside namespaces as it is', async () => {
    await storage.updateRef(REF_FILTER, OID_A);
    writePackedRefs([`${OID_C} ${REF_FILTER}`]);

    await storage.dropPackedNamespaceRefs();

    expect(await storage.readRef(REF_FILTER)).toBe(OID_A);
  });
});

describe('a repository without packed-refs', () => {
  it('reports a missing ref as null and deleting it as a no-op', async () => {
    expect(await storage.readRef(REF_A)).toBeNull();
    await expect(storage.deleteRef(REF_A)).resolves.toBeUndefined();
  });

  it('reads and deletes a loose ref', async () => {
    await storage.updateRef(REF_A, OID_A);

    expect(await storage.readRef(REF_A)).toBe(OID_A);
    await storage.deleteRef(REF_A);
    expect(looseRef(REF_A)).toBeNull();
  });

  it('dropPackedNamespaceRefs() is a no-op', async () => {
    await expect(storage.dropPackedNamespaceRefs()).resolves.toBeUndefined();
  });
});

describe('an old, unreferenced object that a write reuses', () => {
  // The write has not been committed to a ref yet when the gc runs.
  it.each([
    ['blob', () => storage.writeBlob(Buffer.from('reused blob'))],
    [
      'tree',
      async () =>
        storage.writeTree([
          {
            mode: '100644',
            path: 'page.md',
            oid: await storage.writeBlob(Buffer.from('tree member')),
            type: 'blob',
          },
        ]),
    ],
    [
      'commit',
      async () =>
        storage.writeCommit({
          tree: await storage.writeTree([]),
          parents: [],
          message: 'reused commit',
          author: BOT,
          committer: BOT,
        }),
    ],
  ])('survives a gc when it is a loose %s', async (_type, write) => {
    const oid = await write();
    ageLooseObject(oid);

    expect(await write()).toBe(oid);
    runProductionGc();

    expect(hasObject(oid)).toBe(true);
  });

  it('survives a gc when it only exists in a pack', async () => {
    const write = () => storage.writeBlob(Buffer.from('packed blob'));
    const oid = await write();
    ageLooseObject(oid);
    runGit('-c', 'gc.packRefs=false', 'gc', '--prune=never');
    expect(fs.existsSync(looseObjectPath(oid))).toBe(false);

    expect(await write()).toBe(oid);
    runProductionGc();

    expect(hasObject(oid)).toBe(true);
  });

  it('is written again when a prune removes it while the write is reusing it', async () => {
    const write = () => storage.writeBlob(Buffer.from('raced blob'));
    const oid = await write();
    const realUtimes = fs.promises.utimes;
    // Stands in for a prune that unlinks the object right after the write
    // saw it on disk.
    vi.spyOn(fs.promises, 'utimes').mockImplementationOnce((file, ...rest) => {
      fs.rmSync(file as string);
      return realUtimes(file, ...rest);
    });

    expect(await write()).toBe(oid);

    expect(hasObject(oid)).toBe(true);
  });

  it('is pruned by a gc when no write reused it', async () => {
    const oid = await storage.writeBlob(Buffer.from('abandoned blob'));
    ageLooseObject(oid);

    runProductionGc();

    expect(hasObject(oid)).toBe(false);
  });
});

describe('readCommitParents()', () => {
  it('returns no parent for a root commit and the parent for its child', async () => {
    const tree = await storage.writeTree([]);
    const root = await storage.writeCommit({
      tree,
      parents: [],
      message: 'root',
      author: BOT,
      committer: BOT,
    });
    const child = await storage.writeCommit({
      tree,
      parents: [root],
      message: 'child',
      author: BOT,
      committer: BOT,
    });

    expect(await storage.readCommitParents(root)).toEqual([]);
    expect(await storage.readCommitParents(child)).toEqual([root]);
  });
});

describe('namespace refs as a whole', () => {
  const VIEW_REF = 'refs/namespaces/user-u1-view/refs/heads/main';

  it('listNamespaces() names every namespace that has anything on disk', async () => {
    await storage.updateRef(REF_A, OID_A);
    await storage.ensureNamespaceHead('user-u1-view');
    await storage.updateRef(REF_FILTER, OID_C);

    expect([...(await storage.listNamespaces())].sort()).toEqual([
      'public',
      'user-u1-view',
    ]);
  });

  it('listNamespaces() is empty before any namespace is written', async () => {
    expect(await storage.listNamespaces()).toEqual([]);
  });

  it('deleteAllNamespaceRefs() removes every namespace and keeps refs outside namespaces', async () => {
    await storage.updateRef(REF_A, OID_A);
    await storage.updateRef(VIEW_REF, OID_B);
    await storage.ensureNamespaceHead('user-u1-view');
    await storage.updateRef(REF_FILTER, OID_C);

    await storage.deleteAllNamespaceRefs();

    expect(await storage.listNamespaces()).toEqual([]);
    expect(await storage.readRef(REF_A)).toBeNull();
    expect(await storage.readRef(VIEW_REF)).toBeNull();
    expect(await storage.readRef(REF_FILTER)).toBe(OID_C);
  });

  it('deleteAllNamespaceRefs() is a no-op before any namespace is written', async () => {
    await expect(storage.deleteAllNamespaceRefs()).resolves.toBeUndefined();
  });
});
