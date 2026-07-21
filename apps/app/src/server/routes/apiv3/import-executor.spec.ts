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
    importService.import.mockResolvedValue(undefined);
    const adminEvent = mock<EventEmitter>();
    const activityEvent = mock<EventEmitter>();

    await executeImport({
      importService,
      adminEvent,
      activityEvent,
      activityId,
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
      collections,
      importSettingsMap,
    });

    expect(adminEvent.emit).toHaveBeenCalledWith('onErrorForImport', {
      message: 'boom',
    });
    expect(activityEvent.emit).not.toHaveBeenCalled();
  });
});
