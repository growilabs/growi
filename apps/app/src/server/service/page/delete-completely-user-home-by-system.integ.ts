import type EventEmitter from 'events';
import mongoose from 'mongoose';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { IPage } from '^/../../packages/core/dist';

import { getPageSchema } from '~/server/models/obsolete-page';
import { configManager } from '~/server/service/config-manager';

import type { PageModel } from '../../models/page';
import pageModel from '../../models/page';
import { deleteCompletelyUserHomeBySystem } from './delete-completely-user-home-by-system';
import type { IPageService } from './page-service';

// TODO: use actual user model after ~/server/models/user.js becomes importable in vitest
// ref: https://github.com/vitest-dev/vitest/issues/846
const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    username: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
  },
  {
    timestamps: true,
  },
);
const User = mongoose.model('User', userSchema);

describe('delete-completely-user-home-by-system test', () => {
  let Page: PageModel;

  const initialEnv = process.env;

  const userId1 = new mongoose.Types.ObjectId();
  const user1HomepageId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    // setup page model
    getPageSchema(null);
    pageModel(null);
    Page = mongoose.model<IPage, PageModel>('Page');

    // setup config
    await configManager.loadConfigs();
    await configManager.updateConfig('app:isV5Compatible', true);
    const isV5Compatible = configManager.getConfig('app:isV5Compatible');
    expect(isV5Compatible).toBeTruthy();

    // setup user documents
    const user1 = await User.create({
      _id: userId1,
      name: 'user1',
      username: 'user1',
      email: 'user1@example.com',
    });

    // setup page documents
    await Page.insertMany([
      {
        _id: user1HomepageId,
        path: '/user/user1',
        grant: Page.GRANT_PUBLIC,
        creator: user1,
        lastUpdateUser: user1,
        parent: new mongoose.Types.ObjectId(),
        descendantCount: 2,
        isEmpty: false,
        status: 'published',
      },
      {
        path: '/user/user1/subpage1',
        grant: Page.GRANT_PUBLIC,
        creator: user1,
        lastUpdateUser: user1,
        parent: user1HomepageId,
      },
      {
        path: '/user/user1/subpage2',
        grant: Page.GRANT_PUBLIC,
        creator: user1,
        lastUpdateUser: user1,
        parent: user1HomepageId,
      },
    ]);
  });

  afterAll(() => {
    process.env = initialEnv;
    Page.deleteMany({});
  });

  describe('deleteCompletelyUserHomeBySystem()', () => {
    // setup
    const mockUpdateDescendantCountOfAncestors = vi
      .fn()
      .mockImplementation(() => Promise.resolve());
    const mockDeleteCompletelyOperation = vi
      .fn()
      .mockImplementation(() => Promise.resolve());
    const mockPageEvent = mock<EventEmitter>();
    const mockDeleteMultipleCompletely = vi
      .fn()
      .mockImplementation(() => Promise.resolve());

    const mockPageService = mock<IPageService>({
      updateDescendantCountOfAncestors: mockUpdateDescendantCountOfAncestors,
      deleteCompletelyOperation: mockDeleteCompletelyOperation,
      getEventEmitter: () => mockPageEvent,
      deleteMultipleCompletely: mockDeleteMultipleCompletely,
    });

    it('should call used page service functions', async () => {
      // when
      const existsUserHomepagePath = '/user/user1';
      await deleteCompletelyUserHomeBySystem(
        existsUserHomepagePath,
        mockPageService,
      );

      // then
      expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalled();
      expect(mockDeleteCompletelyOperation).toHaveBeenCalled();
      expect(mockPageEvent.emit).toHaveBeenCalled();
      expect(mockDeleteMultipleCompletely).toHaveBeenCalled();
    });

    it('should throw error if userHomepage is not exists', async () => {
      // when
      const notExistsUserHomepagePath = '/user/not_exists_user';
      const deleteUserHomepageFunction = deleteCompletelyUserHomeBySystem(
        notExistsUserHomepagePath,
        mockPageService,
      );

      // then
      expect(deleteUserHomepageFunction).rejects.toThrow(
        'user homepage is not found.',
      );
    });
  });
});
