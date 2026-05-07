/**
 * Unit tests for StorageStatsController
 *
 * MongoDB aggregation (VaultNamespaceStateModel), git child_process.execFile,
 * and fs.promises are all mocked so that tests run without external services.
 */
import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------
vi.mock('../services/vault-repo-storage.js', () => ({
  getRepoPath: vi.fn(() => '/data/vault-repo.git'),
}));
vi.mock('../models/vault-namespace-state.js', () => ({
  VaultNamespaceStateModel: {
    aggregate: vi.fn(),
  },
}));
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, execFile: vi.fn() };
});

// ---------------------------------------------------------------------------
// Module under test (imported after mocks)
// ---------------------------------------------------------------------------
import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import { StorageStatsController } from './storage-stats-controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json }, status, json };
}
/**
 * Configures the VaultNamespaceStateModel.aggregate mock to return the given
 * namespace and version totals.
 */
function mockAggregate(namespaceCount, totalVersion) {
  const execMock = vi
    .fn()
    .mockResolvedValue(
      namespaceCount === 0
        ? []
        : [{ _id: null, count: namespaceCount, totalVersion }],
    );
  vi.mocked(VaultNamespaceStateModel.aggregate).mockReturnValue({
    exec: execMock,
  });
}
const mockedExecFile = childProcess.execFile;
/**
 * Configures execFile (already mocked by vi.mock above) to invoke its
 * callback with a successful stdout, simulating `git count-objects` output.
 */
function mockExecFile(stdout) {
  // biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
  mockedExecFile.mockImplementation((...args) => {
    const callback = args[args.length - 1];
    callback(null, stdout, '');
  });
}
/**
 * Configures execFile to invoke its callback with an error, simulating a
 * git failure.
 */
function mockExecFileError(err) {
  // biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
  mockedExecFile.mockImplementation((...args) => {
    const callback = args[args.length - 1];
    callback(err, '', '');
  });
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('StorageStatsController', () => {
  let controller;
  beforeEach(() => {
    controller = new StorageStatsController();
    // Default fs mocks: repo dir contains two files of 1024 bytes each.
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue(
      // Cast because readdir has multiple overloads; we only use the
      // string-array variant in the implementation.
      ['objects', 'HEAD'],
    );
    vi.spyOn(fs.promises, 'stat').mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: overloaded signature
      (p) => {
        const strPath = String(p);
        const isDir = strPath.endsWith('vault-repo.git');
        return Promise.resolve({
          isDirectory: () => isDir,
          size: isDir ? 0 : 1024,
        });
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  describe('happy path', () => {
    it('returns 200 with a complete StorageStatsResponse', async () => {
      mockAggregate(3, 12);
      mockExecFile(
        '5 objects, 10 kilobytes\n10 in-pack, 0 packs, 2560 bytes\n',
      );
      const { res, status, json } = makeRes();
      await controller.getStorageStats(res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          namespaceCount: 3,
          totalCommitCount: 12,
          looseObjectCount: 5,
          repoSizeBytes: expect.any(Number),
          lastSquashAt: null,
          lastGcAt: null,
        }),
      );
    });
    it('returns repoSizeBytes as sum of all file sizes under repoPath', async () => {
      mockAggregate(1, 4);
      mockExecFile('0 objects, 0 kilobytes\n');
      const { res, json } = makeRes();
      await controller.getStorageStats(res);
      // Two files of 1024 bytes each = 2048
      const body = vi.mocked(json).mock.calls[0][0];
      expect(body.repoSizeBytes).toBe(2048);
    });
    it('returns zeros when the collection is empty', async () => {
      mockAggregate(0, 0);
      mockExecFile('0 objects, 0 kilobytes\n');
      const { res, status, json } = makeRes();
      await controller.getStorageStats(res);
      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ namespaceCount: 0, totalCommitCount: 0 }),
      );
    });
  });
  // -------------------------------------------------------------------------
  // MongoDB aggregate failure
  // -------------------------------------------------------------------------
  describe('when MongoDB aggregation fails', () => {
    it('responds with 500', async () => {
      vi.mocked(VaultNamespaceStateModel.aggregate).mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error('MongoNetworkError')),
      });
      mockExecFile('0 objects, 0 kilobytes\n');
      const { res, status } = makeRes();
      await controller.getStorageStats(res);
      expect(status).toHaveBeenCalledWith(500);
    });
  });
  // -------------------------------------------------------------------------
  // git count-objects failure
  // -------------------------------------------------------------------------
  describe('when git count-objects fails', () => {
    it('responds with 500', async () => {
      mockAggregate(2, 8);
      mockExecFileError(new Error('git not found'));
      const { res, status } = makeRes();
      await controller.getStorageStats(res);
      expect(status).toHaveBeenCalledWith(500);
    });
  });
});
//# sourceMappingURL=storage-stats-controller.spec.js.map
