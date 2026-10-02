import { describe, expect, it } from 'vitest';

import type { IPageBulkExportJobSnapshot } from './page-bulk-export-job-client';
import { parseSnapshot } from './page-bulk-export-job-client';

describe('parseSnapshot (client-safe)', () => {
  it('should parse a valid snapshot string into IPageBulkExportJobSnapshot', () => {
    const snapshot = JSON.stringify({ path: '/test/page' });
    const result: IPageBulkExportJobSnapshot = parseSnapshot(snapshot);

    expect(result).toEqual({ path: '/test/page' });
  });
});
