import { prisma } from '~/utils/prisma';

describe('PageRedirect', () => {
  beforeEach(async () => {
    // clear collection
    await prisma.pageredirects.deleteMany({});
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

  describe('.deleteRedirectsCreatedByMove', () => {
    const fromPaths = async (): Promise<string[]> =>
      (await prisma.pageredirects.findMany({ select: { fromPath: true } }))
        .map((r) => r.fromPath)
        .sort();

    test('deletes only redirects mapping the moved tree onto the same place under the destination', async () => {
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: '/a', toPath: '/b' },
          { fromPath: '/a/child', toPath: '/b/child' },
          { fromPath: '/a/child/grand', toPath: '/b/child/grand' },
          { fromPath: '/a/old', toPath: '/x' },
          { fromPath: '/a/legacy', toPath: '/b/other' },
          { fromPath: '/a/sub', toPath: '/b' },
          { fromPath: '/ab', toPath: '/bb' },
          { fromPath: '/ab/child', toPath: '/b/child' },
          { fromPath: '/x/a', toPath: '/b' },
        ],
      });

      const result = await prisma.pageredirects.deleteRedirectsCreatedByMove({
        fromPath: '/a',
        toPath: '/b',
      });

      expect(result.count).toBe(3);
      expect(await fromPaths()).toEqual([
        '/a/legacy',
        '/a/old',
        '/a/sub',
        '/ab',
        '/ab/child',
        '/x/a',
      ]);
    });

    test('keeps a redirect from the source path itself that points elsewhere', async () => {
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: '/a', toPath: '/elsewhere' },
          { fromPath: '/a/child', toPath: '/b/child' },
        ],
      });

      const result = await prisma.pageredirects.deleteRedirectsCreatedByMove({
        fromPath: '/a',
        toPath: '/b',
      });

      expect(result.count).toBe(1);
      expect(await fromPaths()).toEqual(['/a']);
    });

    test('pairs a destination with a trailing slash the way a rename builds child targets', async () => {
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: '/a', toPath: '/b/' },
          { fromPath: '/a/child', toPath: '/b//child' },
          { fromPath: '/a/other', toPath: '/b/other' },
        ],
      });

      const result = await prisma.pageredirects.deleteRedirectsCreatedByMove({
        fromPath: '/a',
        toPath: '/b/',
      });

      expect(result.count).toBe(2);
      expect(await fromPaths()).toEqual(['/a/other']);
    });

    test('treats regex metacharacters and non-ASCII whitespace in both paths literally', async () => {
      const from = '/a.b (1)　x';
      const to = '/移動先 [仮]　y';
      await prisma.pageredirects.createMany({
        data: [
          { fromPath: from, toPath: to },
          { fromPath: `${from}/子`, toPath: `${to}/子` },
          { fromPath: '/aXb (1)　x', toPath: to },
          { fromPath: '/aXb (1)　x/子', toPath: `${to}/子` },
          { fromPath: `${from}/別`, toPath: '/移動先 X　y/別' },
        ],
      });

      const result = await prisma.pageredirects.deleteRedirectsCreatedByMove({
        fromPath: from,
        toPath: to,
      });

      expect(result.count).toBe(2);
      expect(await fromPaths()).toEqual(
        [`${from}/別`, '/aXb (1)　x', '/aXb (1)　x/子'].sort(),
      );
    });

    test('deletes nothing when no redirect matches', async () => {
      await prisma.pageredirects.createMany({
        data: [{ fromPath: '/keep', toPath: '/t' }],
      });

      const result = await prisma.pageredirects.deleteRedirectsCreatedByMove({
        fromPath: '/none',
        toPath: '/t',
      });

      expect(result.count).toBe(0);
      expect(await prisma.pageredirects.count()).toBe(1);
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
  });
});
