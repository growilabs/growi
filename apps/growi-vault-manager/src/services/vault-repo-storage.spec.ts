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

const { mockLoggerInfo, mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@growi/logger', () => ({
  loggerFactory: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_C = 'c'.repeat(40);
const REF_A = 'refs/namespaces/public/refs/heads/main';
const REF_B = 'refs/namespaces/group-g1/refs/heads/main';

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
  fs.rmSync(path.join(repoPath, 'refs', 'namespaces'), {
    recursive: true,
    force: true,
  });
});

describe('init() on a repository with packed-refs', () => {
  it('restores a packed ref that has no loose file, logs it, and removes packed-refs', async () => {
    writePackedRefs([`${OID_A} ${REF_A}`]);

    await storage.init();

    expect(looseRef(REF_A)).toBe(OID_A);
    expect(fs.existsSync(path.join(repoPath, 'packed-refs'))).toBe(false);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ ref: REF_A, oid: OID_A }),
      expect.any(String),
    );
  });

  it('keeps a loose ref over its packed value and logs both values', async () => {
    await storage.updateRef(REF_A, OID_B);
    writePackedRefs([`${OID_A} ${REF_A}`]);

    await storage.init();

    expect(looseRef(REF_A)).toBe(OID_B);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: REF_A,
        packedOid: OID_A,
        looseOid: OID_B,
      }),
      expect.any(String),
    );
  });

  it('ignores the header and peeled lines', async () => {
    writePackedRefs([`${OID_A} ${REF_A}`, `^${OID_C}`, `${OID_B} ${REF_B}`]);

    await storage.init();

    expect(looseRef(REF_A)).toBe(OID_A);
    expect(looseRef(REF_B)).toBe(OID_B);
  });
});

describe('ref access while packed-refs exists', () => {
  it('readRef refuses to report a ref without a loose file as missing', async () => {
    writePackedRefs([`${OID_A} ${REF_A}`]);

    await expect(storage.readRef(REF_A)).rejects.toThrow(/packed-refs/);
  });

  it('deleteRef refuses to treat a ref without a loose file as deleted', async () => {
    writePackedRefs([`${OID_A} ${REF_A}`]);

    await expect(storage.deleteRef(REF_A)).rejects.toThrow(/packed-refs/);
  });

  it('reads and deletes a loose ref as usual', async () => {
    await storage.updateRef(REF_A, OID_A);
    writePackedRefs([`${OID_B} ${REF_B}`]);

    expect(await storage.readRef(REF_A)).toBe(OID_A);
    await storage.deleteRef(REF_A);
    expect(looseRef(REF_A)).toBeNull();
  });
});

describe('ref access without packed-refs', () => {
  it('reports a missing ref as null and deleting it as a no-op', async () => {
    expect(await storage.readRef(REF_A)).toBeNull();
    await expect(storage.deleteRef(REF_A)).resolves.toBeUndefined();
  });
});
