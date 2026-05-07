/**
 * StorageStatsController
 *
 * Provides GET /internal/storage-stats, a SharedSecretAuth-protected endpoint
 * that returns storage observability data for the vault-manager pod.
 *
 * Response shape follows StorageStatsResponse from @growi/core:
 *   - namespaceCount      — distinct namespace count from vault_namespace_state
 *   - totalCommitCount    — sum of version fields across all namespace documents
 *   - looseObjectCount    — loose objects from `git count-objects`
 *   - repoSizeBytes       — total byte size of the bare repo directory
 *   - lastSquashAt        — null (VaultMaintenanceScheduler not yet implemented)
 *   - lastGcAt            — null (VaultMaintenanceScheduler not yet implemented)
 *
 * Returns 200 with StorageStatsResponse on success.
 * Returns 500 on any collection or git failure.
 */

import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { StorageStatsResponse } from '@growi/core/dist/interfaces/vault';
import { Controller, Get, Res, Use } from '@tsed/common';
import type { Response } from 'express';

import { SharedSecretAuth } from '../middlewares/shared-secret-auth.js';
import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import { getRepoPath } from '../services/vault-repo-storage.js';

/**
 * Aggregates the vault_namespace_state collection to obtain:
 *   - the number of distinct namespaces
 *   - the sum of all version counters (proxy for total commit count)
 */
async function collectNamespaceStats(): Promise<{
  namespaceCount: number;
  totalCommitCount: number;
}> {
  const result = await VaultNamespaceStateModel.aggregate<{
    _id: null;
    count: number;
    totalVersion: number;
  }>([
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalVersion: { $sum: '$version' },
      },
    },
  ]).exec();

  if (result.length === 0) {
    // No documents yet — zero counts are valid
    return { namespaceCount: 0, totalCommitCount: 0 };
  }

  return {
    namespaceCount: result[0].count,
    totalCommitCount: result[0].totalVersion,
  };
}

/**
 * Parses the output of `git count-objects` to extract the loose object count.
 *
 * Expected output format (two lines):
 *   <count> objects, <size> kilobytes
 */
function parseCountObjects(stdout: string): number {
  // `git count-objects` first line: "<n> objects, <size> kilobytes"
  const match = stdout.match(/^(\d+)\s+objects/m);
  if (match == null) {
    throw new Error(
      `Unexpected git count-objects output: ${stdout.slice(0, 200)}`,
    );
  }
  return Number.parseInt(match[1], 10);
}

/**
 * Runs `git count-objects` in the bare repository and returns the loose
 * object count.
 *
 * Uses a manual promise wrapper around childProcess.execFile (rather than
 * util.promisify) so that vi.mock('node:child_process') in tests replaces the
 * function that is actually invoked at call time.
 */
function getLooseObjectCount(repoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'git',
      ['--git-dir', repoPath, 'count-objects'],
      (err, stdout) => {
        if (err != null) {
          reject(err);
          return;
        }
        try {
          resolve(parseCountObjects(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}

/**
 * Recursively computes the total byte size of all files under `dirPath`.
 * Uses `fs.readdir` + `fs.stat` because `du` is not portable.
 */
async function computeDirectorySizeBytes(dirPath: string): Promise<number> {
  let totalBytes = 0;

  const processEntry = async (entryPath: string): Promise<void> => {
    const stat = await fs.promises.stat(entryPath);
    if (stat.isDirectory()) {
      const children = await fs.promises.readdir(entryPath);
      await Promise.all(
        children.map((child) => processEntry(path.join(entryPath, child))),
      );
    } else {
      totalBytes += stat.size;
    }
  };

  await processEntry(dirPath);
  return totalBytes;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('/internal')
export class StorageStatsController {
  /**
   * Returns storage observability metrics for the vault bare repository.
   *
   * Protected by SharedSecretAuth (Authorization: Bearer <token>).
   */
  @Get('/storage-stats')
  @Use(SharedSecretAuth)
  async getStorageStats(@Res() res: Response): Promise<void> {
    try {
      const repoPath = getRepoPath();

      // Run all I/O concurrently for minimal latency
      const [namespaceStats, looseObjectCount, repoSizeBytes] =
        await Promise.all([
          collectNamespaceStats(),
          getLooseObjectCount(repoPath),
          computeDirectorySizeBytes(repoPath),
        ]);

      // VaultMaintenanceScheduler is not yet implemented — return null
      const lastSquashAt: string | null = null;
      const lastGcAt: string | null = null;

      const body: StorageStatsResponse = {
        namespaceCount: namespaceStats.namespaceCount,
        totalCommitCount: namespaceStats.totalCommitCount,
        looseObjectCount,
        repoSizeBytes,
        lastSquashAt,
        lastGcAt,
      };

      res.status(200).json(body);
    } catch (err) {
      // Log context so operators can diagnose failures without leaking details
      // to the caller
      const message = err instanceof Error ? err.message : String(err);

      res.status(500).json({
        error: 'Failed to collect storage statistics',
        detail: message,
      });
    }
  }
}
