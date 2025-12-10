import { YDocStatus } from '@growi/core/dist/consts';
import { Types } from 'mongoose';
import type { Server } from 'socket.io';
import { mock } from 'vitest-mock-extended';

import { Revision } from '../../models/revision';
import type { MongodbPersistence } from './extended/mongodb-persistence';
import type { IYjsService } from './yjs';
import { getYjsService, initializeYjsService } from './yjs';

vi.mock('y-socket.io/dist/server', () => {
  const YSocketIO = vi.fn();
  YSocketIO.prototype.on = vi.fn();
  YSocketIO.prototype.initialize = vi.fn();
  return { YSocketIO };
});

vi.mock('../revision/normalize-latest-revision-if-broken', () => ({
  normalizeLatestRevisionIfBroken: vi.fn(),
}));

const ObjectId = Types.ObjectId;

const getPrivateMdbInstance = (yjsService: IYjsService): MongodbPersistence => {
  // eslint-disable-next-line dot-notation
  return yjsService['mdb'];
};

describe('YjsService', () => {
  describe('getYDocStatus()', () => {
    beforeAll(async () => {
      const ioMock = mock<Server>();

      // initialize
      initializeYjsService(ioMock);
    });

    afterAll(async () => {
      // flush revisions
      await Revision.deleteMany({});

      // flush yjs-writings
      const yjsService = getYjsService();
      const privateMdb = getPrivateMdbInstance(yjsService);
      await privateMdb.flushDB();
    });

    it('returns ISOLATED when neither revisions nor YDocs exists', async () => {
      // arrange
      const yjsService = getYjsService();

      const pageId = new ObjectId();

      // act
      const result = await yjsService.getYDocStatus(pageId.toString());

      // assert
      expect(result).toBe(YDocStatus.ISOLATED);
    });

    it('returns ISOLATED when no revisions exist', async () => {
      // arrange
      const yjsService = getYjsService();

      const pageId = new ObjectId();

      const privateMdb = getPrivateMdbInstance(yjsService);
      await privateMdb.setTypedMeta(pageId.toString(), 'updatedAt', 1000);

      // act
      const result = await yjsService.getYDocStatus(pageId.toString());

      // assert
      expect(result).toBe(YDocStatus.ISOLATED);
    });

    it('returns NEW when no YDocs exist', async () => {
      // arrange
      const yjsService = getYjsService();

      const pageId = new ObjectId();

      await Revision.insertMany([{ pageId, body: '' }]);

      // act
      const result = await yjsService.getYDocStatus(pageId.toString());

      // assert
      expect(result).toBe(YDocStatus.NEW);
    });

    it('returns DRAFT when the newer YDocs exist', async () => {
      // arrange
      const yjsService = getYjsService();

      const pageId = new ObjectId();

      await Revision.insertMany([{ pageId, body: '' }]);

      const privateMdb = getPrivateMdbInstance(yjsService);
      await privateMdb.setTypedMeta(
        pageId.toString(),
        'updatedAt',
        new Date(2034, 1, 1).getTime(),
      );

      // act
      const result = await yjsService.getYDocStatus(pageId.toString());

      // assert
      expect(result).toBe(YDocStatus.DRAFT);
    });

    it('returns SYNCED', async () => {
      // arrange
      const yjsService = getYjsService();

      const pageId = new ObjectId();

      await Revision.insertMany([
        { pageId, body: '', createdAt: new Date(2025, 1, 1) },
      ]);

      const privateMdb = getPrivateMdbInstance(yjsService);
      await privateMdb.setTypedMeta(
        pageId.toString(),
        'updatedAt',
        new Date(2025, 1, 1).getTime(),
      );

      // act
      const result = await yjsService.getYDocStatus(pageId.toString());

      // assert
      expect(result).toBe(YDocStatus.SYNCED);
    });

    it('returns OUTDATED when the latest revision is newer than meta data', async () => {
      // arrange
      const yjsService = getYjsService();

      const pageId = new ObjectId();

      await Revision.insertMany([{ pageId, body: '' }]);

      const privateMdb = getPrivateMdbInstance(yjsService);
      await privateMdb.setTypedMeta(
        pageId.toString(),
        'updatedAt',
        new Date(2024, 1, 1).getTime(),
      );

      // act
      const result = await yjsService.getYDocStatus(pageId.toString());

      // assert
      expect(result).toBe(YDocStatus.OUTDATED);
    });
  });
});
