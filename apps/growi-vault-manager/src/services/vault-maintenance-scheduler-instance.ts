import {
  createVaultMaintenanceScheduler,
  type VaultMaintenanceScheduler,
} from './vault-maintenance-scheduler.js';

// Module-level singleton — created once when the module is first imported.
const schedulerInstance: VaultMaintenanceScheduler =
  createVaultMaintenanceScheduler();

/**
 * Returns the module-level VaultMaintenanceScheduler singleton.
 *
 * The instance is created eagerly at module load time; this function is a
 * stable accessor that makes the singleton explicit and mockable in tests.
 */
export function getSchedulerInstance(): VaultMaintenanceScheduler {
  return schedulerInstance;
}

export { schedulerInstance };
