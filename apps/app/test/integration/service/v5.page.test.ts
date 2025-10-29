import type { IPage } from '@growi/core';
import { addSeconds } from 'date-fns/addSeconds';
import mongoose from 'mongoose';

import {
  PageActionStage,
  PageActionType,
} from '../../../src/interfaces/page-operation';
import type Crowi from '../../../src/server/crowi';
import type { PageDocument, PageModel } from '../../../src/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '../../../src/server/models/page-operation';
import { getInstance } from '../setup-crowi';

describe('Test page service methods', () => {
  let crowi: Crowi;
  let Page: PageModel;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let User;
  let PageOperation: PageOperationModel;

  let rootPage: PageDocument;

  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let dummyUser1;

  let pageOpId1: mongoose.Types.ObjectId;
  let pageOpId2: mongoose.Types.ObjectId;
  let pageOpId3: mongoose.Types.ObjectId;
  let pageOpId4: mongoose.Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model('User');
    Page = mongoose.model<IPage, PageModel>('Page');
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    /*
     * Common
     */

    // ***********************************************************************************************************
    // * Do NOT change properties of globally used documents. Otherwise, it might cause some errors in other tests
    // ***********************************************************************************************************
    // users
    dummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
    // page
    rootPage = (await Page.findOne({ path: '/' }))!;

    /**
     * pages
     */
    const pageId0 = new mongoose.Types.ObjectId();
    const pageId1 = new mongoose.Types.ObjectId();
    const pageId2 = new mongoose.Types.ObjectId();
    const pageId3 = new mongoose.Types.ObjectId();
    const pageId4 = new mongoose.Types.ObjectId();
    const pageId5 = new mongoose.Types.ObjectId();
    const pageId6 = new mongoose.Types.ObjectId();
    const pageId7 = new mongoose.Types.ObjectId();
    const pageId8 = new mongoose.Types.ObjectId();
    const pageId9 = new mongoose.Types.ObjectId();
    const pageId10 = new mongoose.Types.ObjectId();
    const pageId11 = new mongoose.Types.ObjectId();
    const pageId12 = new mongoose.Types.ObjectId();
    const pageId13 = new mongoose.Types.ObjectId();
    const pageId14 = new mongoose.Types.ObjectId();
    const pageId15 = new mongoose.Types.ObjectId();
    const pageId16 = new mongoose.Types.ObjectId();
    const pageId17 = new mongoose.Types.ObjectId();
    const pageId18 = new mongoose.Types.ObjectId();
    const pageId19 = new mongoose.Types.ObjectId();
    const pageId20 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageId0,
        path: '/resume_rename_0',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        _id: pageId1,
        path: '/resume_rename_0/resume_rename_1',
        parent: pageId0,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 2,
        isEmpty: false,
      },
      {
        _id: pageId2,
        path: '/resume_rename_1/resume_rename_2',
        parent: pageId1,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        _id: pageId3,
        path: '/resume_rename_1/resume_rename_2/resume_rename_3',
        parent: pageId2,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId4,
        path: '/resume_rename_4',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId5,
        path: '/resume_rename_4/resume_rename_5',
        parent: pageId4,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        _id: pageId6,
        path: '/resume_rename_5/resume_rename_6',
        parent: pageId5,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId7,
        path: '/resume_rename_7',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId8,
        path: '/resume_rename_8',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        _id: pageId9,
        path: '/resume_rename_8/resume_rename_9',
        parent: pageId8,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        path: '/resume_rename_9/resume_rename_10',
        parent: pageId9,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId10,
        path: '/resume_rename_11',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 3,
        isEmpty: false,
      },
      {
        _id: pageId11,
        path: '/resume_rename_11/resume_rename_12',
        parent: pageId10,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 2,
        isEmpty: false,
      },
      {
        _id: pageId12,
        path: '/resume_rename_11/resume_rename_12/resume_rename_13',
        parent: pageId11,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        path: '/resume_rename_11/resume_rename_12/resume_rename_13/resume_rename_14',
        parent: pageId12,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId13,
        path: '/resume_rename_15',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 2,
        isEmpty: false,
      },
      {
        _id: pageId14,
        path: '/resume_rename_15/resume_rename_16',
        parent: pageId13,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId15,
        path: '/resume_rename_15/resume_rename_17',
        parent: pageId13,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        _id: pageId16,
        path: '/resume_rename_15/resume_rename_17/resume_rename_18',
        parent: pageId15,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 1,
        isEmpty: false,
      },
      {
        _id: pageId17,
        path: '/resume_rename_15/resume_rename_17/resume_rename_18/resume_rename_19',
        parent: pageId16,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 0,
        isEmpty: false,
      },
      {
        _id: pageId18,
        path: '/fix_descendantCount_1',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 100, // broken
        isEmpty: false,
      },
      {
        _id: pageId19,
        path: '/fix_descendantCount_1/fix_descendantCount_2',
        parent: pageId18,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 100, // broken
        isEmpty: true,
      },
      {
        path: '/fix_descendantCount_1/fix_descendantCount_2/fix_descendantCount_3',
        parent: pageId19,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 100, // broken
        isEmpty: false,
      },
      {
        _id: pageId20,
        path: '/fix_descendantCount_4',
        parent: rootPage._id,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 100, // broken
        isEmpty: false,
      },
      {
        path: '/fix_descendantCount_4/fix_descendantCount_5',
        parent: pageId20,
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        descendantCount: 100, // broken
        isEmpty: false,
      },
    ]);

    /**
     * PageOperation
     */
    pageOpId1 = new mongoose.Types.ObjectId();
    pageOpId2 = new mongoose.Types.ObjectId();
    pageOpId3 = new mongoose.Types.ObjectId();
    pageOpId4 = new mongoose.Types.ObjectId();
    const pageOpRevisionId1 = new mongoose.Types.ObjectId();
    const pageOpRevisionId2 = new mongoose.Types.ObjectId();
    const pageOpRevisionId3 = new mongoose.Types.ObjectId();
    const pageOpRevisionId4 = new mongoose.Types.ObjectId();

    await PageOperation.insertMany([
      {
        _id: pageOpId1,
        actionType: 'Rename',
        actionStage: 'Sub',
        fromPath: '/resume_rename_1',
        toPath: '/resume_rename_0/resume_rename_1',
        page: {
          _id: pageId1,
          parent: rootPage._id,
          descendantCount: 2,
          isEmpty: false,
          path: '/resume_rename_1',
          revision: pageOpRevisionId1,
          status: 'published',
          grant: 1,
          grantedUsers: [],
          grantedGroups: [],
          creator: dummyUser1._id,
          lastUpdateUser: dummyUser1._id,
        },
        user: {
          _id: dummyUser1._id,
        },
        options: {
          createRedirectPage: false,
          updateMetadata: true,
        },
        unprocessableExpiryDate: null,
      },
      {
        _id: pageOpId2,
        actionType: 'Rename',
        actionStage: 'Sub',
        fromPath: '/resume_rename_5',
        toPath: '/resume_rename_4/resume_rename_5',
        page: {
          _id: pageId5,
          parent: rootPage._id,
          descendantCount: 2,
          isEmpty: false,
          path: '/resume_rename_5',
          revision: pageOpRevisionId2,
          status: 'published',
          grant: 1,
          grantedUsers: [],
          grantedGroups: [],
          creator: dummyUser1._id,
          lastUpdateUser: dummyUser1._id,
        },
        user: {
          _id: dummyUser1._id,
        },
        options: {
          createRedirectPage: false,
          updateMetadata: true,
        },
        unprocessableExpiryDate: new Date(),
      },
      {
        _id: pageOpId3,
        actionType: 'Rename',
        actionStage: 'Sub',
        fromPath: '/resume_rename_7',
        // toPath NOT exist
        page: {
          _id: pageId7,
          parent: rootPage._id,
          descendantCount: 2,
          isEmpty: false,
          path: '/resume_rename_7',
          revision: pageOpRevisionId3,
          status: 'published',
          grant: 1,
          grantedUsers: [],
          grantedGroups: [],
          creator: dummyUser1._id,
          lastUpdateUser: dummyUser1._id,
        },
        user: {
          _id: dummyUser1._id,
        },
        options: {
          createRedirectPage: false,
          updateMetadata: true,
        },
        unprocessableExpiryDate: new Date(),
      },
      {
        _id: pageOpId4,
        actionType: 'Rename',
        actionStage: 'Sub',
        fromPath: '/resume_rename_9',
        toPath: '/resume_rename_8/resume_rename_9',
        page: {
          _id: pageId9,
          parent: rootPage._id,
          descendantCount: 1,
          isEmpty: false,
          path: '/resume_rename_9',
          revision: pageOpRevisionId4,
          status: 'published',
          grant: Page.GRANT_PUBLIC,
          grantedUsers: [],
          grantedGroups: [],
          creator: dummyUser1._id,
          lastUpdateUser: dummyUser1._id,
        },
        user: {
          _id: dummyUser1._id,
        },
        options: {
          createRedirectPage: false,
          updateMetadata: true,
        },
        unprocessableExpiryDate: null,
      },
    ]);
  });

  describe('restart renameOperation', () => {
    const resumeRenameSubOperation = async (renamePage, pageOp, activity?) => {
      const mockedPathsAndDescendantCountOfAncestors = jest
        .spyOn(crowi.pageService, 'fixPathsAndDescendantCountOfAncestors')
        .mockReturnValue(null);
      await crowi.pageService.resumeRenameSubOperation(
        renamePage,
        pageOp,
        activity,
      );

      const argsForRenameSubOperation =
        mockedPathsAndDescendantCountOfAncestors.mock.calls[0];

      mockedPathsAndDescendantCountOfAncestors.mockRestore();
      await crowi.pageService.fixPathsAndDescendantCountOfAncestors(
        ...argsForRenameSubOperation,
      );
    };

    test('it should successfully restart rename operation', async () => {
      // paths before renaming
      const _path0 = '/resume_rename_0'; // out of renaming scope
      const _path1 = '/resume_rename_0/resume_rename_1'; // renamed already
      const _path2 = '/resume_rename_1/resume_rename_2'; // not renamed yet
      const _path3 = '/resume_rename_1/resume_rename_2/resume_rename_3'; // not renamed yet

      // paths after renaming
      const path0 = '/resume_rename_0';
      const path1 = '/resume_rename_0/resume_rename_1';
      const path2 = '/resume_rename_0/resume_rename_1/resume_rename_2';
      const path3 =
        '/resume_rename_0/resume_rename_1/resume_rename_2/resume_rename_3';

      // activity options
      const activity = 'randomActivityId';

      // page
      const _page0 = await Page.findOne({ path: _path0 });
      const _page1 = await Page.findOne({ path: _path1 });
      const _page2 = await Page.findOne({ path: _path2 });
      const _page3 = await Page.findOne({ path: _path3 });
      expect(_page0).toBeTruthy();
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();

      expect(_page0?.descendantCount).toBe(1);
      expect(_page1?.descendantCount).toBe(2);
      expect(_page2?.descendantCount).toBe(1);
      expect(_page3?.descendantCount).toBe(0);

      // page operation
      const fromPath = '/resume_rename_1';
      const toPath = '/resume_rename_0/resume_rename_1';
      const _pageOperation = await PageOperation.findOne({
        _id: pageOpId1,
        fromPath,
        toPath,
        'page._id': _page1?._id,
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Sub,
      });
      expect(_pageOperation).toBeTruthy();

      // rename
      await resumeRenameSubOperation(_page1, _pageOperation, activity);

      // page
      const page0 = await Page.findById(_page0?._id);
      const page1 = await Page.findById(_page1?._id);
      const page2 = await Page.findById(_page2?._id);
      const page3 = await Page.findById(_page3?._id);
      expect(page0).toBeTruthy();
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();
      // check paths after renaming
      expect(page0?.path).toBe(path0);
      expect(page1?.path).toBe(path1);
      expect(page2?.path).toBe(path2);
      expect(page3?.path).toBe(path3);

      // page operation
      const pageOperation = await PageOperation.findById(_pageOperation?._id);
      expect(pageOperation).toBeNull(); // should not exist

      expect(page0?.descendantCount).toBe(3);
      expect(page1?.descendantCount).toBe(2);
      expect(page2?.descendantCount).toBe(1);
      expect(page3?.descendantCount).toBe(0);
    });
    test('it should successfully restart rename operation when unprocessableExpiryDate is null', async () => {
      // paths before renaming
      const _path0 = '/resume_rename_8'; // out of renaming scope
      const _path1 = '/resume_rename_8/resume_rename_9'; // renamed already
      const _path2 = '/resume_rename_9/resume_rename_10'; // not renamed yet

      // paths after renaming
      const path0 = '/resume_rename_8';
      const path1 = '/resume_rename_8/resume_rename_9';
      const path2 = '/resume_rename_8/resume_rename_9/resume_rename_10';

      // activity options
      const activityParameters = {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/rename',
        activityId: '62e291bc10e0ab61bd691794',
      };

      // page
      const _page0 = await Page.findOne({ path: _path0 });
      const _page1 = await Page.findOne({ path: _path1 });
      const _page2 = await Page.findOne({ path: _path2 });
      expect(_page0).toBeTruthy();
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();

      expect(_page0?.descendantCount).toBe(1);
      expect(_page1?.descendantCount).toBe(1);
      expect(_page2?.descendantCount).toBe(0);

      // page operation
      const fromPath = '/resume_rename_9';
      const toPath = '/resume_rename_8/resume_rename_9';
      const _pageOperation = await PageOperation.findOne({
        _id: pageOpId4,
        fromPath,
        toPath,
        'page._id': _page1?._id,
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Sub,
      });
      expect(_pageOperation).toBeTruthy();

      // rename
      await resumeRenameSubOperation(
        _page1,
        _pageOperation,
        activityParameters,
      );

      // page
      const page0 = await Page.findById(_page0?._id);
      const page1 = await Page.findById(_page1?._id);
      const page2 = await Page.findById(_page2?._id);
      expect(page0).toBeTruthy();
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      // check paths after renaming
      expect(page0?.path).toBe(path0);
      expect(page1?.path).toBe(path1);
      expect(page2?.path).toBe(path2);

      // page operation
      const pageOperation = await PageOperation.findById(_pageOperation?._id);
      expect(pageOperation).toBeNull(); // should not exist

      // others
      expect(page1?.parent).toStrictEqual(page0?._id);
      expect(page2?.parent).toStrictEqual(page1?._id);
      expect(page0?.descendantCount).toBe(2);
      expect(page1?.descendantCount).toBe(1);
      expect(page2?.descendantCount).toBe(0);
    });
    test('it should fail and throw error if the current time is behind unprocessableExpiryDate', async () => {
      // path before renaming
      const _path0 = '/resume_rename_4'; // out of renaming scope
      const _path1 = '/resume_rename_4/resume_rename_5'; // renamed already
      const _path2 = '/resume_rename_5/resume_rename_6'; // not renamed yet
      // page
      const _page0 = await Page.findOne({ path: _path0 });
      const _page1 = await Page.findOne({ path: _path1 });
      const _page2 = await Page.findOne({ path: _path2 });
      expect(_page0).toBeTruthy();
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();

      // page operation
      const fromPath = '/resume_rename_5';
      const toPath = '/resume_rename_4/resume_rename_5';
      const _pageOperation = await PageOperation.findOne({
        _id: pageOpId2,
        fromPath,
        toPath,
        'page._id': _page1?._id,
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Sub,
      });
      expect(_pageOperation).toBeTruthy();

      // Make `unprocessableExpiryDate` 15 seconds ahead of current time.
      // The number 15 seconds has no meaning other than placing time in the furue.
      const pageOperation = await PageOperation.findByIdAndUpdate(
        _pageOperation?._id,
        { unprocessableExpiryDate: addSeconds(new Date(), 15) },
        { new: true },
      );
      expect(pageOperation).toBeTruthy();

      await expect(
        resumeRenameSubOperation(_page1, pageOperation),
      ).rejects.toThrow(
        new Error('This page operation is currently being processed'),
      );

      // cleanup
      await PageOperation.findByIdAndDelete(pageOperation?._id);
    });
    test('Missing property(toPath) for PageOperation should throw error', async () => {
      // page
      const _path1 = '/resume_rename_7';
      const _page1 = await Page.findOne({ path: _path1 });
      expect(_page1).toBeTruthy();

      // page operation
      const pageOperation = await PageOperation.findOne({
        _id: pageOpId3,
        'page._id': _page1?._id,
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Sub,
      });
      expect(pageOperation).toBeTruthy();

      const promise = resumeRenameSubOperation(_page1, pageOperation);
      await expect(promise).rejects.toThrow(
        new Error(
          `Property toPath is missing which is needed to resume rename operation(${pageOperation?._id})`,
        ),
      );

      // cleanup
      await PageOperation.findByIdAndDelete(pageOperation?._id);
    });
  });
  describe('updateDescendantCountOfPagesWithPaths', () => {
    test('should fix descendantCount of pages with one of the given paths', async () => {
      // path
      const _path1 = '/fix_descendantCount_1';
      const _path2 = '/fix_descendantCount_1/fix_descendantCount_2'; // empty
      const _path3 =
        '/fix_descendantCount_1/fix_descendantCount_2/fix_descendantCount_3';
      const _path4 = '/fix_descendantCount_4';
      const _path5 = '/fix_descendantCount_4/fix_descendantCount_5';
      // page
      const _page1 = await Page.findOne({ path: _path1 });
      const _page2 = await Page.findOne({ path: _path2 });
      const _page3 = await Page.findOne({ path: _path3 });
      const _page4 = await Page.findOne({ path: _path4 });
      const _page5 = await Page.findOne({ path: _path5 });
      // check existance
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page3).toBeTruthy();
      expect(_page4).toBeTruthy();
      expect(_page5).toBeTruthy();
      // check descendantCount (all broken)
      expect(_page1?.descendantCount).toBe(100);
      expect(_page2?.descendantCount).toBe(100);
      expect(_page3?.descendantCount).toBe(100);
      expect(_page4?.descendantCount).toBe(100);
      expect(_page5?.descendantCount).toBe(100);
      // check isEmpty
      expect(_page1?.isEmpty).toBe(false);
      expect(_page2?.isEmpty).toBe(true);
      expect(_page3?.isEmpty).toBe(false);
      expect(_page4?.isEmpty).toBe(false);
      expect(_page5?.isEmpty).toBe(false);
      // check parent
      expect(_page1?.parent).toStrictEqual(rootPage._id);
      expect(_page2?.parent).toStrictEqual(_page1?._id);
      expect(_page3?.parent).toStrictEqual(_page2?._id);
      expect(_page4?.parent).toStrictEqual(rootPage._id);
      expect(_page5?.parent).toStrictEqual(_page4?._id);

      await crowi.pageService.updateDescendantCountOfPagesWithPaths([
        _path1,
        _path2,
        _path3,
        _path4,
        _path5,
      ]);

      // page
      const page1 = await Page.findById(_page1?._id);
      const page2 = await Page.findById(_page2?._id);
      const page3 = await Page.findById(_page3?._id);
      const page4 = await Page.findById(_page4?._id);
      const page5 = await Page.findById(_page5?._id);

      // check existance
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();
      expect(page4).toBeTruthy();
      expect(page5).toBeTruthy();
      // check descendantCount (all fixed)
      expect(page1?.descendantCount).toBe(1);
      expect(page2?.descendantCount).toBe(1);
      expect(page3?.descendantCount).toBe(0);
      expect(page4?.descendantCount).toBe(1);
      expect(page5?.descendantCount).toBe(0);
      // check isEmpty
      expect(page1?.isEmpty).toBe(false);
      expect(page2?.isEmpty).toBe(true);
      expect(page3?.isEmpty).toBe(false);
      expect(page4?.isEmpty).toBe(false);
      expect(page5?.isEmpty).toBe(false);
      // check parent
      expect(page1?.parent).toStrictEqual(rootPage._id);
      expect(page2?.parent).toStrictEqual(page1?._id);
      expect(page3?.parent).toStrictEqual(page2?._id);
      expect(page4?.parent).toStrictEqual(rootPage._id);
      expect(page5?.parent).toStrictEqual(page4?._id);
    });
  });
});
