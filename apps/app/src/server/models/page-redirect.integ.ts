import PageRedirect from './page-redirect';

describe('PageRedirect', () => {
  beforeEach(async () => {
    // clear collection
    await PageRedirect.deleteMany({});
  });

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
      // a chain is followed per input, so one $in query serves both
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

    test('shoud return an empty map without querying for an empty input', async () => {
      // setup:
      const aggregateSpy = vi.spyOn(PageRedirect, 'aggregate');

      // when:
      const endpointsByFromPath =
        await PageRedirect.retrievePageRedirectEndpointsBatch([]);

      // then:
      expect(endpointsByFromPath.size).toEqual(0);
      // an empty $in yields an empty map either way, so only the skipped round
      // trip distinguishes the guard from its absence
      expect(aggregateSpy).not.toHaveBeenCalled();

      aggregateSpy.mockRestore();
    });
  });
});
