import mongoose from 'mongoose';

import { getInstance } from '../setup-crowi';

describe('PageRedirect', () => {
  // biome-ignore lint/correctness/noUnusedVariables: ignore
  let crowi;
  let PageRedirect;

  beforeAll(async () => {
    crowi = await getInstance();

    PageRedirect = mongoose.model('PageRedirect');
  });

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
      expect(endpoints.start).not.toBeNull();
      expect(endpoints.start.fromPath).toEqual('/path1');
      expect(endpoints.start.toPath).toEqual('/path2');
      expect(endpoints.end).not.toBeNull();
      expect(endpoints.end.fromPath).toEqual('/path1');
      expect(endpoints.end.toPath).toEqual('/path2');
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
      expect(endpoints.start).not.toBeNull();
      expect(endpoints.start.fromPath).toEqual('/path1');
      expect(endpoints.start.toPath).toEqual('/path2');
      expect(endpoints.end).not.toBeNull();
      expect(endpoints.end.fromPath).toEqual('/path3');
      expect(endpoints.end.toPath).toEqual('/path4');
    });
  });
});
