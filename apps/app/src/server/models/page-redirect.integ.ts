import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

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
    await prisma.pageredirects.deleteMany({});
    mocks.logger.warn.mockClear();
  });

  /** A rename chain /p0 -> /p1 -> ... -> /p{length}. */
  const insertChain = async (length: number): Promise<void> => {
    await prisma.pageredirects.createMany({
      data: Array.from({ length }, (_, i) => ({
        fromPath: `/p${i}`,
        toPath: `/p${i + 1}`,
      })),
    });
  };

  // Duplicate fromPaths can only be staged below the Prisma client, with the
  // unique index Mongoose builds on connect dropped first.
  const rawCollection = () => mongoose.connection.collection('pageredirects');
  const restoreIndexes = async (): Promise<void> => {
    await mongoose.model('PageRedirect').syncIndexes();
  };

  describe('.removePageRedirectsByToPath (duplicate fromPath)', () => {
    test('shoud remove only the document pointing at the path, not its duplicate', async () => {
      // Same reachable state as the batch static's duplicate case: two documents
      // share a fromPath, each pointing somewhere different. Unlinking one target
      // must not take the other redirect with it.
      // setup:
      await prisma.pageredirects.create({
        data: { fromPath: '/dup', toPath: '/first' },
      });
      await rawCollection().dropIndexes();
      try {
        await rawCollection().insertOne({
          fromPath: '/dup',
          toPath: '/second',
        });

        // when:
        await prisma.pageredirects.removePageRedirectsByToPath('/first');

        // then:
        const left = await prisma.pageredirects.findMany({
          where: { fromPath: '/dup' },
        });
        expect(left).toHaveLength(1);
        expect(left[0].toPath).toEqual('/second');
      } finally {
        await rawCollection().deleteMany({ fromPath: '/dup' });
        await restoreIndexes();
      }
    });
  });

  describe('.retrieveFromPathsRedirectingTo', () => {
    test('shoud collect every fromPath whose chain reaches the path, at any depth', async () => {
      // setup: /p0 -> /p1 -> /p2 -> /p3, plus one unrelated redirect
      await insertChain(3);
      await prisma.pageredirects.createMany({
        data: [{ fromPath: '/other', toPath: '/elsewhere' }],
      });

      // when:
      const fromPaths =
        await prisma.pageredirects.retrieveFromPathsRedirectingTo('/p3');

      // then: the direct hop and both upstream ones, and nothing else
      expect([...fromPaths].sort()).toEqual(['/p0', '/p1', '/p2']);
    });

    test('shoud return an empty array when nothing redirects to the path', async () => {
      // setup:
      await insertChain(3);

      // when / then:
      expect(
        await prisma.pageredirects.retrieveFromPathsRedirectingTo('/p0'),
      ).toEqual([]);
    });

    test('shoud stop walking back at the depth cap it is given', async () => {
      // setup: /p0 -> ... -> /p5
      await insertChain(5);

      // when: the matched hop contributes /p4, then the walk back adds depth 0 and
      // depth 1 — the cap is inclusive, as on the forward static
      const fromPaths =
        await prisma.pageredirects.retrieveFromPathsRedirectingTo('/p5', 1);

      // then: /p1 and /p0 are past the cap
      expect([...fromPaths].sort()).toEqual(['/p2', '/p3', '/p4']);
    });

    test('shoud walk back to the real start when given no depth cap', async () => {
      // setup:
      await insertChain(5);

      // when / then:
      expect(
        (await prisma.pageredirects.retrieveFromPathsRedirectingTo('/p5'))
          .length,
      ).toEqual(5);
    });
  });

  describe('.removePageRedirectsByToPath', () => {
    test('works fine', async () => {
      // setup:
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: '/org/path1', toPath: '/path1' },
          { fromPath: '/org/path2', toPath: '/path2' },
          { fromPath: '/org/path3', toPath: '/path3' },
          { fromPath: '/org/path33', toPath: '/org/path333' },
          { fromPath: '/org/path333', toPath: '/path3' },
        ],
      });
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path1' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path2' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path3' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path33' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path333' },
        }),
      ).not.toBeNull();

      // when:
      // remove all documents that have { toPath: '/path/3' }
      await prisma.pageredirects.removePageRedirectsByToPath('/path3');

      // then:
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path1' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path2' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path3' },
        }),
      ).toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path33' },
        }),
      ).toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path333' },
        }),
      ).toBeNull();
    });
  });

  describe('.createManyIgnoringDuplicates', () => {
    test('creates every document when there is no collision', async () => {
      // when:
      await prisma.pageredirects.createManyIgnoringDuplicates([
        { fromPath: '/org/path1', toPath: '/path1' },
        { fromPath: '/org/path2', toPath: '/path2' },
      ]);

      // then:
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path1' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path2' },
        }),
      ).not.toBeNull();
    });

    test('keeps the existing document and inserts the rest when a fromPath collides', async () => {
      // setup:
      await prisma.pageredirects.createMany({
        data: [{ fromPath: '/org/path1', toPath: '/original-target' }],
      });

      // when:
      // '/org/path1' collides with the existing document above
      await prisma.pageredirects.createManyIgnoringDuplicates([
        { fromPath: '/org/path1', toPath: '/conflicting-target' },
        { fromPath: '/org/path2', toPath: '/path2' },
      ]);

      // then:
      // the pre-existing document is untouched, and the non-colliding one is created
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path1' },
        }),
      ).toMatchObject({ toPath: '/original-target' });
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/org/path2' },
        }),
      ).not.toBeNull();
    });
  });

  describe('.retrievePageRedirectEndpoints', () => {
    test('shoud return null when data is not found', async () => {
      // setup:
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/path1' },
        }),
      ).toBeNull();

      // when:
      // retrieve
      const endpoints =
        await prisma.pageredirects.retrievePageRedirectEndpoints('/path1');

      // then:
      expect(endpoints).toBeNull();
    });

    test('shoud return IPageRedirectEnds (start and end is the same)', async () => {
      // setup:
      await prisma.pageredirects.createMany({
        data: [{ fromPath: '/path1', toPath: '/path2' }],
      });
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/path1' },
        }),
      ).not.toBeNull();

      // when:
      // retrieve
      const endpoints =
        await prisma.pageredirects.retrievePageRedirectEndpoints('/path1');

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
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: '/path1', toPath: '/path2' },
          { fromPath: '/path2', toPath: '/path3' },
          { fromPath: '/path3', toPath: '/path4' },
        ],
      });
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/path1' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/path2' },
        }),
      ).not.toBeNull();
      expect(
        await prisma.pageredirects.findFirst({
          where: { fromPath: '/path3' },
        }),
      ).not.toBeNull();

      // when:
      // retrieve
      const endpoints =
        await prisma.pageredirects.retrievePageRedirectEndpoints('/path1');

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
      const endpoints =
        await prisma.pageredirects.retrievePageRedirectEndpoints('/p0');

      // then:
      expect(endpoints?.end.toPath).toEqual('/p60');
    });
  });

  describe('.retrievePageRedirectEndpointsBatch', () => {
    test('shoud resolve every requested fromPath to its own chain endpoint', async () => {
      // setup:
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: '/path1', toPath: '/path2' },
          { fromPath: '/path2', toPath: '/path3' },
          { fromPath: '/other1', toPath: '/other2' },
          { fromPath: '/unrequested', toPath: '/nowhere' },
        ],
      });

      // when:
      const endpointsByFromPath =
        await prisma.pageredirects.retrievePageRedirectEndpointsBatch([
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
      await prisma.pageredirects.createMany({
        data: [{ fromPath: '/path1', toPath: '/path2' }],
      });

      // when:
      const endpointsByFromPath =
        await prisma.pageredirects.retrievePageRedirectEndpointsBatch([
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
        await prisma.pageredirects.retrievePageRedirectEndpointsBatch(
          ['/p0'],
          50,
        );

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
        await prisma.pageredirects.retrievePageRedirectEndpointsBatch(['/p0']);

      // then:
      expect(endpointsByFromPath.get('/p0')?.end.toPath).toEqual('/p60');
    });

    test('shoud use the first of two documents sharing a fromPath, and warn', async () => {
      // Reachable where the unique index build failed over duplicates left by the
      // 2022 data migration: MongoDB refuses such a build and the app keeps
      // running, so which document wins must not depend on aggregation order.
      // setup:
      await rawCollection().dropIndexes();
      try {
        await rawCollection().insertMany([
          { fromPath: '/dup', toPath: '/first' },
          { fromPath: '/dup', toPath: '/second' },
        ]);

        // when:
        const endpointsByFromPath =
          await prisma.pageredirects.retrievePageRedirectEndpointsBatch([
            '/dup',
          ]);

        // then:
        expect(endpointsByFromPath.get('/dup')?.end.toPath).toEqual('/first');
        expect(mocks.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('/dup'),
        );
      } finally {
        await rawCollection().deleteMany({ fromPath: '/dup' });
        await restoreIndexes();
      }
    });

    test('shoud return an empty map for an empty input', async () => {
      // when:
      const endpointsByFromPath =
        await prisma.pageredirects.retrievePageRedirectEndpointsBatch([]);

      // then:
      expect(endpointsByFromPath.size).toEqual(0);
    });
  });
});
