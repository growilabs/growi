import type EventEmitter from 'node:events';

import { SupportedAction } from '~/interfaces/activity';
import type { PendingActivityContext } from '~/server/service/activity/index';
import { pendingActivityContext } from '~/server/service/activity/index';
import type { ImportSettings } from '~/server/service/import';
import type { ImportResult } from '~/server/service/import/import';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:import-executor');

/** Minimal surface of ImportService needed to run an import. */
export interface ImportRunner {
  import(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<ImportResult>;
}

export interface ExecuteImportArgs {
  importService: ImportRunner;
  adminEvent: EventEmitter;
  activityEvent: EventEmitter;
  /**
   * The activity id the `add-activity` middleware minted for this request.
   * `undefined` when it never got that far: the middleware catches its own failures and
   * calls `next()` without setting `res.locals.activity`, and the import — the work the
   * operator actually asked for — must not be lost over a missing audit row.
   */
  activityId: string | undefined;
  /**
   * The request-time activity context, captured by the route BEFORE it sent the
   * response. The import runs after the response, by which time
   * `registerFailsafeFinalizer` has cleared this id's entry from
   * `pendingActivityContext` on the response's 'finish' event; without
   * re-arming it here the deferred `emit('update')` below would settle the row
   * with `user: null` (same root cause as PR #11510). `undefined` when the
   * middleware never minted a context (best-effort).
   */
  activityContext: PendingActivityContext | undefined;
  collections: string[];
  importSettingsMap: Map<string, ImportSettings>;
}

/**
 * Run the archive import and report the outcome over the admin / activity event
 * buses.
 *
 * The HTTP response has already been sent by the time this runs (the route
 * responds immediately and streams progress over WebSocket), so the import must
 * be awaited here: without the await a rejection from importService.import()
 * escapes as an unhandled rejection, 'onErrorForImport' is never emitted, and
 * the client sees the import silently do nothing.
 *
 * Three outcomes, and each one has to reach the operator differently:
 *  - every collection imported → the audit row is settled, and ImportService has
 *    already emitted 'onTerminateForImport' for the screen;
 *  - some collections failed → 'onErrorForImport', and no audit row;
 *  - the whole run threw → 'onErrorForImport', and no audit row.
 */
export const executeImport = async ({
  importService,
  adminEvent,
  activityEvent,
  activityId,
  activityContext,
  collections,
  importSettingsMap,
}: ExecuteImportArgs): Promise<void> => {
  try {
    const { failedCollections } = await importService.import(
      collections,
      importSettingsMap,
    );

    if (failedCollections.length > 0) {
      // An import carries on past a collection it could not read, so a run can finish
      // having quietly left part of the wiki behind. This is the only point at which the
      // admin screen can be told: ImportService withholds its own 'onTerminateForImport'
      // for such a run precisely so that the screen does not report a completion nobody
      // can take back, and the screen has no other channel.
      //
      // No ACTION_ADMIN_GROWI_DATA_IMPORTED either. The operator is about to decide
      // whether to switch maintenance mode off and open the wiki, and whoever reads the
      // audit log afterwards must not find a clean success for a run that lost data.
      // (There is no audit action for a failed import today; adding one would mean
      // extending SupportedAction, which is out of this change's reach.)
      logger.error(
        { failedCollections },
        'The import finished with collections missing',
      );
      adminEvent.emit('onErrorForImport', {
        message: `Collections that could not be imported: ${failedCollections.join(', ')}`,
      });
      return;
    }

    if (activityId == null) {
      // Nothing to settle — see ExecuteImportArgs.activityId. The import itself is done.
      return;
    }

    // Re-arm the context captured before the response (see
    // ExecuteImportArgs.activityContext) so the ActivityService listener's
    // synchronous take() settles this row with the operator, not null.
    if (activityContext != null) {
      pendingActivityContext.set(activityId, activityContext);
    }
    activityEvent.emit('update', activityId, {
      action: SupportedAction.ACTION_ADMIN_GROWI_DATA_IMPORTED,
    });
  } catch (err) {
    logger.error(err);
    adminEvent.emit('onErrorForImport', { message: (err as Error).message });
  }
};
