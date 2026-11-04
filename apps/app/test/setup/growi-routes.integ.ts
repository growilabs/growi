import { listGrowiRoutes } from './growi-routes';

describe('listGrowiRoutes', () => {
  // Booting Crowi and registering every route takes several seconds.
  beforeAll(async () => {
    await listGrowiRoutes();
  }, 60_000);

  test.each([
    { method: 'GET', path: '/_api/v3/page/exist' },
    { method: 'GET', path: '/_api/search' },
    { method: 'GET', path: '/share/:linkId' },
  ])('includes the registered route $method $path', async ({
    method,
    path,
  }) => {
    const routes = await listGrowiRoutes();

    expect(routes.map((r) => `${r.method} ${r.path}`)).toContain(
      `${method} ${path}`,
    );
  });

  test('returns the same enumeration on repeated calls instead of registering routes twice', async () => {
    const first = await listGrowiRoutes();
    const second = await listGrowiRoutes();

    expect(second).toBe(first);
  });
});
