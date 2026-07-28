import type EventEmitter from 'node:events';

import { SupportedAction } from '~/interfaces/activity';
import type { ImportSettings } from '~/server/service/import';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:import-executor');

/** Minimal surface of ImportService needed to run an import. */
export interface ImportRunner {
  import(
    collections: string[],
    importSettingsMap: Map<string, ImportSettings>,
  ): Promise<void>;
}

export interface ExecuteImportArgs {
  importService: ImportRunner;
  adminEvent: EventEmitter;
  activityEvent: EventEmitter;
  activityId: unknown;
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
 */
export const executeImport = async ({
  importService,
  adminEvent,
  activityEvent,
  activityId,
  collections,
  importSettingsMap,
}: ExecuteImportArgs): Promise<void> => {
  try {
    await importService.import(collections, importSettingsMap);

    activityEvent.emit('update', activityId, {
      action: SupportedAction.ACTION_ADMIN_GROWI_DATA_IMPORTED,
    });
  } catch (err) {
    logger.error(err);
    adminEvent.emit('onErrorForImport', { message: (err as Error).message });
  }
};
