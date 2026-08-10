import { EventEmitter } from 'node:events';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

import { ImportService } from './import';

const buildImportService = (): ImportService =>
  new ImportService(
    mock<Crowi>({
      tmpDir: '/tmp/import-job-lease-spec',
      events: { admin: new EventEmitter() },
    }),
  );

describe('ImportService.acquireImportJob', () => {
  test('refuses a second claim while the first is still held', () => {
    const importService = buildImportService();

    expect(importService.acquireImportJob()).not.toBeNull();
    expect(importService.acquireImportJob()).toBeNull();
  });

  test('lets the next claim through once the first is released', () => {
    const importService = buildImportService();

    const first = importService.acquireImportJob();
    first?.release();

    expect(importService.acquireImportJob()).not.toBeNull();
  });

  test('ignores a release from a holder that no longer owns the job', () => {
    // The G2G receive route releases on the response's `close`, which can fire long after
    // the request is over. Without the ownership check that late release would hand the
    // next import's protection away while it is still running.
    const importService = buildImportService();

    const first = importService.acquireImportJob();
    first?.release();
    const second = importService.acquireImportJob();

    first?.release();

    expect(importService.acquireImportJob()).toBeNull();
    // ...and the holder that does own it can still let go.
    second?.release();
    expect(importService.acquireImportJob()).not.toBeNull();
  });

  test('tolerates being released twice', () => {
    const importService = buildImportService();

    const lease = importService.acquireImportJob();
    lease?.release();
    lease?.release();

    expect(importService.acquireImportJob()).not.toBeNull();
  });
});
