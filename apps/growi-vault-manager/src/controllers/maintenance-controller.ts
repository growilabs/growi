/**
 * MaintenanceController
 *
 * Manual triggers for vault maintenance tasks (git gc, namespace squash).
 * The same operations run automatically on the VaultMaintenanceScheduler
 * tick; these endpoints exist so operators (and integration tests) can
 * invoke them on demand without waiting for the next scheduled tick.
 *
 * Authentication is enforced by SharedSecretAuth (requirement 7.1).
 */

import { UseBefore } from '@tsed/common';
import { Controller } from '@tsed/di';
import { InternalServerError } from '@tsed/exceptions';
import { Logger } from '@tsed/logger';
import { Post, Returns } from '@tsed/schema';

import { SharedSecretAuth } from '../middlewares/shared-secret-auth.js';
import type { GcResult } from '../services/vault-maintenance-scheduler.js';
import { getSchedulerInstance } from '../services/vault-maintenance-scheduler-instance.js';

@Controller('/internal/maintenance')
@UseBefore(SharedSecretAuth)
export class MaintenanceController {
  constructor(private readonly logger: Logger) {}

  /**
   * Trigger a `git gc --prune=2.weeks.ago` run regardless of the loose-object
   * threshold.  Returns before/after loose object counts and elapsed time.
   */
  @Post('/trigger-gc')
  @(Returns(200).ContentType('application/json'))
  @Returns(401)
  @Returns(500)
  async triggerGc(): Promise<GcResult> {
    try {
      return await getSchedulerInstance().triggerGc();
    } catch (err) {
      this.logger.error('trigger-gc failed', err);
      throw new InternalServerError(
        err instanceof Error ? err.message : 'trigger-gc failed',
      );
    }
  }
}
