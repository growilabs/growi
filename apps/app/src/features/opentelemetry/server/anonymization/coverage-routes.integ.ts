import { listGrowiRoutes } from '^/test/setup/growi-routes';

import { COVERAGE_EXAMPLES } from './rules/coverage-examples';

// Express registers some routes with a trailing slash; the examples never do.
const stripTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

describe('coverage examples route existence', () => {
  // Booting Crowi and registering every route takes several seconds.
  beforeAll(async () => {
    await listGrowiRoutes();
  }, 60_000);

  test('every route written in a coverage example is a registered route', async () => {
    const registered = new Set(
      (await listGrowiRoutes()).map(
        (r) => `${r.method} ${stripTrailingSlash(r.path)}`,
      ),
    );

    const missing = COVERAGE_EXAMPLES.flatMap((example) => {
      if (example.route == null) return [];
      const key = `${example.method ?? 'GET'} ${example.route}`;
      return registered.has(key) ? [] : [`${example.id}: ${key}`];
    });

    expect(missing).toEqual([]);
  });
});
