/**
 * Unit tests for StorageStatsController
 *
 * MongoDB aggregation (VaultNamespaceStateModel), git child_process.execFile,
 * and fs.promises are all mocked so that tests run without external services.
 */

import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../services/vault-repo-storage.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../services/vault-repo-storage.js')>();
  return {
    ...actual,
    getRepoPath: vi.fn(() => '/data/vault-repo.git'),
  };
});

vi.mock('../models/vault-namespace-state.js', () => ({
  VaultNamespaceStateModel: {
    aggregate: vi.fn(),
  },
}));

const { mockCountDocuments } = vi.hoisted(() => ({
  mockCountDocuments: vi.fn(),
}));

vi.mock('../models/vault-instruction.js', () => ({
  VaultInstructionModel: {
    countDocuments: mockCountDocuments,
  },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execFile: vi.fn() };
});

vi.mock(
  '../services/vault-maintenance-scheduler-instance.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../services/vault-maintenance-scheduler-instance.js')
      >();
    return {
      ...actual,
      getSchedulerInstance: vi.fn(),
    };
  },
);

// ---------------------------------------------------------------------------
// Module under test (imported after mocks)
// ---------------------------------------------------------------------------

import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import type { VaultMaintenanceScheduler } from '../services/vault-maintenance-scheduler.js';
import { getSchedulerInstance } from '../services/vault-maintenance-scheduler-instance.js';
import { StorageStatsController } from './storage-stats-controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
}

/**
 * Configures the VaultNamespaceStateModel.aggregate mock to return the given
 * namespace and version totals.
 */
function mockAggregate(namespaceCount: number, totalVersion: number): void {
  const execMock = vi
    .fn()
    .mockResolvedValue(
      namespaceCount === 0
        ? []
        : [{ _id: null, count: namespaceCount, totalVersion }],
    );
  vi.mocked(VaultNamespaceStateModel.aggregate).mockReturnValue({
    exec: execMock,
  } as unknown as ReturnType<typeof VaultNamespaceStateModel.aggregate>);
}

// Typed handle for the mocked execFile; cast through unknown because the
// execFile overloads make vi.mocked() incompatible with a simple callback
// mock signature.
// biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
type AnyFn = (...args: any[]) => void;
const mockedExecFile = childProcess.execFile as unknown as {
  mockImplementation: (fn: AnyFn) => void;
};

/**
 * Configures execFile (already mocked by vi.mock above) to invoke its
 * callback with a successful stdout, simulating `git count-objects` output.
 */
function mockExecFile(stdout: string): void {
  // biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
  mockedExecFile.mockImplementation((...args: any[]) => {
    const callback = args[args.length - 1];
    callback(null, stdout, '');
  });
}

/**
 * Configures execFile to invoke its callback with an error, simulating a
 * git failure.
 */
function mockExecFileError(err: Error): void {
  // biome-ignore lint/suspicious/noExplicitAny: overloaded Node.js API
  mockedExecFile.mockImplementation((...args: any[]) => {
    const callback = args[args.length - 1];
    callback(err, '', '');
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageStatsController', () => {
  let controller: StorageStatsController;

  beforeEach(() => {
    controller = new StorageStatsController();

    // Default: no stuck instructions.
    mockCountDocuments.mockResolvedValue(0);

    // Default: scheduler returns null for both timestamps.
    vi.mocked(getSchedulerInstance).mockReturnValue({
      getLastSquashAt: () => null,
      getLastGcAt: () => null,
    } as VaultMaintenanceScheduler);

    // Default fs mocks: repo dir contains two files of 1024 bytes each.
    vi.spyOn(fs.promises, 'readdir').mockResolvedValue(
      // Cast because readdir has multiple overloads; we only use the
      // string-array variant in the implementation.
      ['objects', 'HEAD'] as unknown as Awaited<
        ReturnType<typeof fs.promises.readdir>
      >,
    );

    vi.spyOn(fs.promises, 'stat').mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: overloaded signature
      (p: any) => {
        const strPath = String(p);
        const isDir = strPath.endsWith('vault-repo.git');
        return Promise.resolve({
          isDirectory: () => isDir,
          size: isDir ? 0 : 1024,
        } as Awaited<ReturnType<typeof fs.promises.stat>>);
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
      const body = vi.mocked(json).mock.calls[0][0] as {
        repoSizeBytes: number;
      };
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
  // 13.3 — stuckInstructionCount
  // -------------------------------------------------------------------------

  describe('stuckInstructionCount (task 13.3)', () => {
    it('includes stuckInstructionCount in the response when there are stuck instructions', async () => {
      mockAggregate(2, 8);
      mockExecFile('3 objects, 10 kilobytes\n');
      mockCountDocuments.mockResolvedValue(3);

      const { res, status, json } = makeRes();
      await controller.getStorageStats(res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ stuckInstructionCount: 3 }),
      );
    });

    it('includes stuckInstructionCount: 0 when no instructions are stuck', async () => {
      mockAggregate(1, 4);
      mockExecFile('0 objects, 0 kilobytes\n');
      mockCountDocuments.mockResolvedValue(0);

      const { res, status, json } = makeRes();
      await controller.getStorageStats(res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ stuckInstructionCount: 0 }),
      );
    });

    it('queries VaultInstructionModel.countDocuments with processedAt: null and attempts $gte 5', async () => {
      mockAggregate(1, 2);
      mockExecFile('0 objects, 0 kilobytes\n');
      mockCountDocuments.mockResolvedValue(0);

      const { res } = makeRes();
      await controller.getStorageStats(res);

      expect(mockCountDocuments).toHaveBeenCalledWith({
        processedAt: null,
        attempts: { $gte: 5 },
      });
    });
  });

  // -------------------------------------------------------------------------
  // MongoDB aggregate failure
  // -------------------------------------------------------------------------

  describe('when MongoDB aggregation fails', () => {
    it('responds with 500', async () => {
      vi.mocked(VaultNamespaceStateModel.aggregate).mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error('MongoNetworkError')),
      } as unknown as ReturnType<typeof VaultNamespaceStateModel.aggregate>);
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

  // -------------------------------------------------------------------------
  // 15.3 — scheduler singleton response serialization
  // -------------------------------------------------------------------------

  describe('scheduler singleton response serialization (task 15.3)', () => {
    describe('scenario 1: scheduler returns null for both timestamps', () => {
      beforeEach(() => {
        vi.mocked(getSchedulerInstance).mockReturnValue({
          getLastSquashAt: () => null,
          getLastGcAt: () => null,
        } as VaultMaintenanceScheduler);
      });

      it('includes lastSquashAt: null in the response', async () => {
        mockAggregate(1, 4);
        mockExecFile('0 objects, 0 kilobytes\n');

        const { res, status, json } = makeRes();
        await controller.getStorageStats(res);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ lastSquashAt: null }),
        );
      });

      it('includes lastGcAt: null in the response', async () => {
        mockAggregate(1, 4);
        mockExecFile('0 objects, 0 kilobytes\n');

        const { res, status, json } = makeRes();
        await controller.getStorageStats(res);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({ lastGcAt: null }),
        );
      });
    });

    describe('scenario 2: scheduler returns Date for both timestamps', () => {
      const squashDate = new Date('2026-01-01T00:00:00.000Z');
      const gcDate = new Date('2026-01-02T00:00:00.000Z');

      beforeEach(() => {
        vi.mocked(getSchedulerInstance).mockReturnValue({
          getLastSquashAt: () => squashDate,
          getLastGcAt: () => gcDate,
        } as VaultMaintenanceScheduler);
      });

      it('serializes lastSquashAt as an ISO 8601 string', async () => {
        mockAggregate(1, 4);
        mockExecFile('0 objects, 0 kilobytes\n');

        const { res, status, json } = makeRes();
        await controller.getStorageStats(res);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            lastSquashAt: squashDate.toISOString(),
          }),
        );
      });

      it('serializes lastGcAt as an ISO 8601 string', async () => {
        mockAggregate(1, 4);
        mockExecFile('0 objects, 0 kilobytes\n');

        const { res, status, json } = makeRes();
        await controller.getStorageStats(res);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            lastGcAt: gcDate.toISOString(),
          }),
        );
      });
    });
  });
});
