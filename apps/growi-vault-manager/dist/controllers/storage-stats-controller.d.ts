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
import type { Response } from 'express';
export declare class StorageStatsController {
  /**
   * Returns storage observability metrics for the vault bare repository.
   *
   * Protected by SharedSecretAuth (Authorization: Bearer <token>).
   */
  getStorageStats(res: Response): Promise<void>;
}
