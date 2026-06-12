/**
 * services/reconcile/index.ts — public barrel for the vault reconcile module.
 *
 * This is the ONLY entry point for external consumers. Internal modules
 * (target-resolver, acl-evaluator, concurrency-controller, orchestrator,
 * history-store) are NOT re-exported from here — callers must go through
 * this barrel.
 *
 * Exported surface:
 *   - createVaultReconcileService(deps): VaultReconcileService  (factory)
 *   - VaultReconcileServiceDeps                                  (dep interface)
 *   - VaultReconcileService                                      (return interface)
 *   - ReconcileSubmitResult / ReconcileRequest / ReconcileRejectReason
 *   - ReconcileTargetType
 *   - ReconcileLogEntry                                          (history entry type)
 */

export type {
  ReconcileLogEntry,
  ReconcileRejectReason,
  ReconcileRequest,
  ReconcileSubmitResult,
  ReconcileTargetType,
  VaultReconcileService,
  VaultReconcileServiceDeps,
} from './reconcile-service.js';
export { createVaultReconcileService } from '~/features/growi-vault/server/services/reconcile/reconcile-service.js';
