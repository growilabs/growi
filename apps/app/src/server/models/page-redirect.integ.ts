import PageRedirect from './page-redirect';

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('~/utils/logger', () => ({ default: () => mocks.logger }));

describe('PageRedirect', () => {
  beforeEach(async () => {
    // clear collection
    await PageRedirect.deleteMany({});
    mocks.logger.warn.mockClear();
  });

  /** A rename chain /p0 -> /p1 -> ... -> /p{length}. */
  const insertChain = async (length: number): Promise<void> => {
    await PageRedirect.insertMany(
      Array.from({ length }, (_, i) => ({
        fromPath: `/p${i}`,
        toPath: `/p${i + 1}`,
      })),
    );
  };

  describe('.removePageRedirectsByToPath', () => {
    test('works fine', async () => {
      // setup:
      await PageRedirect.insertMany([
        { fromPath: '/org/path1', toPath: '/path1' },
        { fromPath: '/org/path2', toPath: '/path2' },
        { fromPath: '/org/path3', toPath: '/path3' },
        { fromPath: '/org/path33', toPath: '/org/path333' },
        { fromPath: '/org/path333', toPath: '/path3' },
      ]);
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path1' }),
      ).not.toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path2' }),
      ).not.toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path3' }),
      ).not.toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path33' }),
      ).not.toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path333' }),
      ).not.toBeNull();

      // when:
      // remove all documents that have { toPath: '/path/3' }
      await PageRedirect.removePageRedirectsByToPath('/path3');

      // then:
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path1' }),
      ).not.toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path2' }),
      ).not.toBeNull();
      expect(await PageRedirect.findOne({ fromPath: '/org/path3' })).toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path33' }),
      ).toBeNull();
      expect(
        await PageRedirect.findOne({ fromPath: '/org/path333' }),
      ).toBeNull();
    });
  });

  describe('.retrievePageRedirectEndpoints', () => {
    test('shoud return null when data is not found', async () => {
      // setup:
      expect(await PageRedirect.findOne({ fromPath: '/path1' })).toBeNull();

      // when:
      // retrieve
      const endpoints =
        await PageRedirect.retrievePageRedirectEndpoints('/path1');

      // then:
      expect(endpoints).toBeNull();
    });

    test('shoud return IPageRedirectEnds (start and end is the same)', async () => {
      // setup:
      await PageRedirect.insertMany([{ fromPath: '/path1', toPath: '/path2' }]);
      expect(await PageRedirect.findOne({ fromPath: '/path1' })).not.toBeNull();

      // when:
      // retrieve
      const endpoints =
        await PageRedirect.retrievePageRedirectEndpoints('/path1');

      // then:
      expect(endpoints).not.toBeNull();
      expect(endpoints?.start).not.toBeNull();
      expect(endpoints?.start.fromPath).toEqual('/path1');
      expect(endpoints?.start.toPath).toEqual('/path2');
      expect(endpoints?.end).not.toBeNull();
      expect(endpoints?.end.fromPath).toEqual('/path1');
      expect(endpoints?.end.toPath).toEqual('/path2');
    });

    test('shoud return IPageRedirectEnds', async () => {
      // setup:
      await PageRedirect.insertMany([
        { fromPath: '/path1', toPath: '/path2' },
        { fromPath: '/path2', toPath: '/path3' },
        { fromPath: '/path3', toPath: '/path4' },
      ]);
      expect(await PageRedirect.findOne({ fromPath: '/path1' })).not.toBeNull();
      expect(await PageRedirect.findOne({ fromPath: '/path2' })).not.toBeNull();
      expect(await PageRedirect.findOne({ fromPath: '/path3' })).not.toBeNull();

      // when:
      // retrieve
      const endpoints =
        await PageRedirect.retrievePageRedirectEndpoints('/path1');

      // then:
      expect(endpoints).not.toBeNull();
      expect(endpoints?.start).not.toBeNull();
      expect(endpoints?.start.fromPath).toEqual('/path1');
      expect(endpoints?.start.toPath).toEqual('/path2');
      expect(endpoints?.end).not.toBeNull();
      expect(endpoints?.end.fromPath).toEqual('/path3');
      expect(endpoints?.end.toPath).toEqual('/path4');
    });

    test('shoud follow a chain of any length, since page view must not 404 on a long one', async () => {
      // This static backs the page-view route: capping it would turn a page that
      // was renamed many times into a not-found for its old URL.
      // setup:
      await insertChain(60);

      // when:
      const endpoints = await PageRedirect.retrievePageRedirectEndpoints('/p0');

      // then:
      expect(endpoints?.end.toPath).toEqual('/p60');
    });
  });

  describe('.retrievePageRedirectEndpointsBatch', () => {
    test('shoud resolve every requested fromPath to its own chain endpoint', async () => {
      // setup:
      await PageRedirect.insertMany([
        { fromPath: '/path1', toPath: '/path2' },
        { fromPath: '/path2', toPath: '/path3' },
        { fromPath: '/other1', toPath: '/other2' },
        { fromPath: '/unrequested', toPath: '/nowhere' },
      ]);

      // when:
      const endpointsByFromPath =
        await PageRedirect.retrievePageRedirectEndpointsBatch([
          '/path1',
          '/other1',
        ]);

      // then:
      expect(endpointsByFromPath.size).toEqual(2);
      expect(endpointsByFromPath.get('/path1')?.start.fromPath).toEqual(
        '/path1',
      );
      expect(endpointsByFromPath.get('/path1')?.end.toPath).toEqual('/path3');
      expect(endpointsByFromPath.get('/other1')?.end.toPath).toEqual('/other2');
      expect(endpointsByFromPath.has('/unrequested')).toBe(false);
    });

    test('shoud omit a fromPath that has no redirect', async () => {
      // setup:
      await PageRedirect.insertMany([{ fromPath: '/path1', toPath: '/path2' }]);

      // when:
      const endpointsByFromPath =
        await PageRedirect.retrievePageRedirectEndpointsBatch([
          '/path1',
          '/never-existed',
        ]);

      // then:
      expect(endpointsByFromPath.size).toEqual(1);
      expect(endpointsByFromPath.has('/never-existed')).toBe(false);
    });

    test('shoud stop following a chain at the depth cap it is given', async () => {
      // setup:
      // uncapped, the walk would reach /p60
      await insertChain(60);

      // when:
      const endpointsByFromPath =
        await PageRedirect.retrievePageRedirectEndpointsBatch(['/p0'], 50);

      // then:
      // depth 0 is the /p1 hop, so maxDepth 50 ends the walk at /p51 -> /p52
      expect(endpointsByFromPath.get('/p0')?.end.toPath).toEqual('/p52');
    });

    test('shoud follow a chain to its real end when given no depth cap', async () => {
      // A cap is a caller's cost decision, so the default must not silently
      // shorten a chain for callers that did not ask for one.
      // setup:
      await insertChain(60);

      // when:
      const endpointsByFromPath =
        await PageRedirect.retrievePageRedirectEndpointsBatch(['/p0']);

      // then:
      expect(endpointsByFromPath.get('/p0')?.end.toPath).toEqual('/p60');
    });

    test('shoud use the first of two documents sharing a fromPath, and warn', async () => {
      // Reachable where the unique index build failed over duplicates left by the
      // 2022 data migration: MongoDB refuses such a build and the app keeps
      // running, so which document wins must not depend on aggregation order.
      // setup:
      await PageRedirect.collection.dropIndexes();
      try {
        await PageRedirect.collection.insertMany([
          { fromPath: '/dup', toPath: '/first' },
          { fromPath: '/dup', toPath: '/second' },
        ]);

        // when:
        const endpointsByFromPath =
          await PageRedirect.retrievePageRedirectEndpointsBatch(['/dup']);

        // then:
        expect(endpointsByFromPath.get('/dup')?.end.toPath).toEqual('/first');
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('/dup'),
        );
      } finally {
        await PageRedirect.collection.deleteMany({ fromPath: '/dup' });
        await PageRedirect.syncIndexes();
      }
    });

    test('shoud return an empty map without querying for an empty input', async () => {
      // setup:
      const aggregateSpy = vi.spyOn(PageRedirect, 'aggregate');

      // when:
      const endpointsByFromPath =
        await PageRedirect.retrievePageRedirectEndpointsBatch([]);

      // then:
      expect(endpointsByFromPath.size).toEqual(0);
      // the map is empty either way; only the skipped round trip shows the guard
      expect(aggregateSpy).not.toHaveBeenCalled();

      aggregateSpy.mockRestore();
    });
  });
});
