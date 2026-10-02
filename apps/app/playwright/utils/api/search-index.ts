import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Trigger a full Elasticsearch reindex (admin-only) and assert it was accepted.
 *
 * Page indexing is event-driven and decoupled from page creation, so a
 * just-created page may not be searchable yet. Tests should rebuild and then
 * poll the search results (e.g. with `expect(...).toPass()`), since the rebuild
 * runs asynchronously on the server.
 */
export const rebuildSearchIndex = async (
  request: APIRequestContext,
): Promise<void> => {
  const res = await request.put('/_api/v3/search/indices', {
    data: { operation: 'rebuild' },
  });
  expect(
    res.ok(),
    `reindex request failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);
};
