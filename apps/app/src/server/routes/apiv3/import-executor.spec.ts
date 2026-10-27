import type EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';

import { executeImport, type ImportRunner } from './import-executor';

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('executeImport', () => {
  const collections = ['tags'];
  const importSettingsMap = new Map();
  const activityId = 'activity-1';

  it('emits an activity update when the import succeeds', async () => {
    const importService = mock<ImportRunner>();
    importService.import.mockResolvedValue({ failedCollections: [] });
    const adminEvent = mock<EventEmitter>();
    const activityEvent = mock<EventEmitter>();

    await executeImport({
      importService,
      adminEvent,
      activityEvent,
      activityId,
      // These cases mock the activity event; the context re-arm (activityContext)
      // is covered end-to-end in import-executor.integ.ts.
      activityContext: undefined,
      collections,
      importSettingsMap,
    });

    expect(activityEvent.emit).toHaveBeenCalledWith('update', activityId, {
      action: SupportedAction.ACTION_ADMIN_GROWI_DATA_IMPORTED,
    });
    expect(adminEvent.emit).not.toHaveBeenCalledWith(
      'onErrorForImport',
      expect.anything(),
    );
  });

  it('reports the collections that failed and records no success activity', async () => {
    // The regression this guards: import() stopped rejecting on a collection it could not
    // read and started reporting the failure in its return value instead. Ignoring that
    // value left the operator with a green "Import process has completed." toast and an
    // ACTION_ADMIN_GROWI_DATA_IMPORTED audit row for a wiki that is missing data — which
    // is exactly what they consult before switching maintenance mode off.
    const importService = mock<ImportRunner>();
    importService.import.mockResolvedValue({
      failedCollections: ['pagetagrelations', 'revisions'],
    });
    const adminEvent = mock<EventEmitter>();
    const activityEvent = mock<EventEmitter>();

    await executeImport({
      importService,
      adminEvent,
      activityEvent,
      activityId,
      activityContext: undefined,
      collections,
      importSettingsMap,
    });

    expect(adminEvent.emit).toHaveBeenCalledWith('onErrorForImport', {
      message:
        'Collections that could not be imported: pagetagrelations, revisions',
    });
    expect(activityEvent.emit).not.toHaveBeenCalled();
  });

  it('runs the import even when the request has no activity id', async () => {
    // add-activity swallows its own failures, so res.locals.activity can be missing. The
    // import is the work the operator asked for; the audit row is not worth losing it
    // over. See ExecuteImportArgs.activityId.
    const importService = mock<ImportRunner>();
    importService.import.mockResolvedValue({ failedCollections: [] });
    const adminEvent = mock<EventEmitter>();
    const activityEvent = mock<EventEmitter>();

    await executeImport({
      importService,
      adminEvent,
      activityEvent,
      activityId: undefined,
      activityContext: undefined,
      collections,
      importSettingsMap,
    });

    expect(importService.import).toHaveBeenCalledWith(
      collections,
      importSettingsMap,
    );
    expect(activityEvent.emit).not.toHaveBeenCalled();
    expect(adminEvent.emit).not.toHaveBeenCalled();
  });

  it('reports the failure over onErrorForImport when the import rejects', async () => {
    // Regression guarded: the import must be awaited so its rejection is caught
    // and surfaced to the client, instead of escaping as an unhandled rejection
    // while the activity is wrongly marked as completed.
    const importService = mock<ImportRunner>();
    importService.import.mockRejectedValue(new Error('boom'));
    const adminEvent = mock<EventEmitter>();
    const activityEvent = mock<EventEmitter>();

    await executeImport({
      importService,
      adminEvent,
      activityEvent,
      activityId,
      // These cases mock the activity event; the context re-arm (activityContext)
      // is covered end-to-end in import-executor.integ.ts.
      activityContext: undefined,
      collections,
      importSettingsMap,
    });

    expect(adminEvent.emit).toHaveBeenCalledWith('onErrorForImport', {
      message: 'boom',
    });
    expect(activityEvent.emit).not.toHaveBeenCalled();
  });
});
