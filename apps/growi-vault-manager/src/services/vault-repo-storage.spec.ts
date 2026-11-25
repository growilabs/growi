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
