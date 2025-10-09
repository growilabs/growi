/* eslint-disable no-unused-vars */

import type { IPage, IRevision } from '@growi/core';
import mongoose from 'mongoose';
import type { CommentModel } from '../../../src/features/comment/server/models/comment';
import type { IComment } from '../../../src/interfaces/comment';
import {
  PageActionStage,
  PageActionType,
} from '../../../src/interfaces/page-operation';
import type { IPageTagRelation } from '../../../src/interfaces/page-tag-relation';
import type { IShareLink } from '../../../src/interfaces/share-link';
import type Crowi from '../../../src/server/crowi';
import type { PageDocument, PageModel } from '../../../src/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '../../../src/server/models/page-operation';
import type {
  IPageRedirect,
  PageRedirectModel,
} from '../../../src/server/models/page-redirect';
import PageTagRelation from '../../../src/server/models/page-tag-relation';
import type {
  IRevisionDocument,
  IRevisionModel,
} from '../../../src/server/models/revision';
import type { ShareLinkModel } from '../../../src/server/models/share-link';
import Tag from '../../../src/server/models/tag';
import { generalXssFilter } from '../../../src/services/general-xss-filter';
import { getInstance } from '../setup-crowi';

describe('PageService page operations with only public pages', () => {
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let dummyUser1;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let dummyUser2;

  let crowi: Crowi;
  let Page: PageModel;
  let Revision: IRevisionModel;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let User;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let Bookmark;
  let Comment: CommentModel;
  let ShareLink: ShareLinkModel;
  let PageRedirect: PageRedirectModel;
  let PageOperation: PageOperationModel;
  let generalXssFilterProcessSpy: jest.SpyInstance;

  let rootPage: PageDocument;

  // page operation ids
  let pageOpId1: mongoose.Types.ObjectId;

  const create = async (path, body, user, options = {}) => {
    const mockedCreateSubOperation = jest
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(null);

    const createdPage = await crowi.pageService.create(
      path,
      body,
      user,
      options,
    );

    const argsForCreateSubOperation = mockedCreateSubOperation.mock.calls[0];

    mockedCreateSubOperation.mockRestore();

    await crowi.pageService.createSubOperation(
      ...(argsForCreateSubOperation as Parameters<
        typeof crowi.pageService.createSubOperation
      >),
    );

    return createdPage;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model('User');
    Page = mongoose.model<IPage, PageModel>('Page');
    Revision = mongoose.model<IRevision, IRevisionModel>('Revision');
    Bookmark = mongoose.model('Bookmark');
    Comment = mongoose.model<IComment, CommentModel>('Comment');
    ShareLink = mongoose.model<IShareLink, ShareLinkModel>('ShareLink');
    PageRedirect = mongoose.model<IPageRedirect, PageRedirectModel>(
      'PageRedirect',
    );
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    /*
     * Common
     */

    dummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
    dummyUser2 = await User.findOne({ username: 'v5DummyUser2' });

    generalXssFilterProcessSpy = jest.spyOn(generalXssFilter, 'process');

    rootPage = (await Page.findOne({ path: '/' }))!;
    if (rootPage == null) {
      const pages = await Page.insertMany([
        { path: '/', grant: Page.GRANT_PUBLIC },
      ]);
      rootPage = pages[0];
    }

    /**
     * create
     * mc_ => model create
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     */
    const pageIdCreate1 = new mongoose.Types.ObjectId();
    await Page.insertMany([
      {
        _id: pageIdCreate1,
        path: '/v5_empty_create_4',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/v5_empty_create_4/v5_create_5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdCreate1,
        isEmpty: false,
      },
    ]);

    /**
     * create by system
     * mc_ => model create
     * emp => empty => page with isEmpty: true
     * pub => public => GRANT_PUBLIC
     */
    const pageIdCreateBySystem1 = new mongoose.Types.ObjectId();
    await Page.insertMany([
      {
        _id: pageIdCreateBySystem1,
        path: '/v5_empty_create_by_system4',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/v5_empty_create_by_system4/v5_create_by_system5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdCreateBySystem1,
        isEmpty: false,
      },
    ]);

    /*
     * Rename
     */
    const pageIdForRename1 = new mongoose.Types.ObjectId();
    const pageIdForRename2 = new mongoose.Types.ObjectId();
    const pageIdForRename3 = new mongoose.Types.ObjectId();
    const pageIdForRename4 = new mongoose.Types.ObjectId();
    const pageIdForRename5 = new mongoose.Types.ObjectId();

    const pageIdForRename7 = new mongoose.Types.ObjectId();
    const pageIdForRename8 = new mongoose.Types.ObjectId();
    const pageIdForRename9 = new mongoose.Types.ObjectId();
    const pageIdForRename10 = new mongoose.Types.ObjectId();
    const pageIdForRename11 = new mongoose.Types.ObjectId();

    const childPageIdForRename1 = new mongoose.Types.ObjectId();
    const childPageIdForRename2 = new mongoose.Types.ObjectId();
    const childPageIdForRename3 = new mongoose.Types.ObjectId();
    const childPageIdForRename4 = new mongoose.Types.ObjectId();
    const childPageIdForRename5 = new mongoose.Types.ObjectId();
    const childPageIdForRename7 = new mongoose.Types.ObjectId();

    const pageIdForRename16 = new mongoose.Types.ObjectId();

    const pageIdForRename17 = new mongoose.Types.ObjectId();
    const pageIdForRename18 = new mongoose.Types.ObjectId();
    const pageIdForRename19 = new mongoose.Types.ObjectId();
    const pageIdForRename20 = new mongoose.Types.ObjectId();
    const pageIdForRename21 = new mongoose.Types.ObjectId();
    const pageIdForRename22 = new mongoose.Types.ObjectId();
    const pageIdForRename23 = new mongoose.Types.ObjectId();
    const pageIdForRename24 = new mongoose.Types.ObjectId();
    const pageIdForRename25 = new mongoose.Types.ObjectId();
    const pageIdForRename26 = new mongoose.Types.ObjectId();
    const pageIdForRename27 = new mongoose.Types.ObjectId();
    const pageIdForRename28 = new mongoose.Types.ObjectId();

    const pageIdForRename29 = new mongoose.Types.ObjectId();
    const pageIdForRename30 = new mongoose.Types.ObjectId();

    pageOpId1 = new mongoose.Types.ObjectId();
    const pageOpRevisionId1 = new mongoose.Types.ObjectId();

    // Create Pages
    await Page.insertMany([
      {
        _id: pageIdForRename1,
        path: '/v5_ParentForRename1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename2,
        path: '/v5_ParentForRename2',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        // id not needed for this data
        path: '/v5_ParentForRename2/dummyChild1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForRename2,
      },
      {
        _id: pageIdForRename3,
        path: '/v5_ParentForRename3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename4,
        path: '/v5_ParentForRename4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename5,
        path: '/v5_ParentForRename5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename7,
        path: '/v5_ParentForRename7',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename8,
        path: '/v5_ParentForRename8',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename9,
        path: '/v5_ParentForRename9',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename10,
        path: '/v5_ParentForRename10',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename11,
        path: '/v5_ParentForRename11',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        _id: childPageIdForRename1,
        path: '/v5_ChildForRename1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: childPageIdForRename2,
        path: '/v5_ChildForRename2',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: childPageIdForRename3,
        path: '/v5_ChildForRename3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        updatedAt: new Date('2021'),
      },
      {
        _id: childPageIdForRename4,
        path: '/v5_ChildForRename4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: childPageIdForRename5,
        path: '/v5_ChildForRename5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: childPageIdForRename7,
        path: '/v5_ChildForRename7',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        path: '/v5_ChildForRename5/v5_GrandchildForRename5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: childPageIdForRename5,
        updatedAt: new Date('2021'),
      },
      {
        path: '/v5_ChildForRename7/v5_GrandchildForRename7',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: childPageIdForRename7,
      },
      {
        _id: pageIdForRename17,
        path: '/v5_pageForRename17',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename18,
        path: '/v5_pageForRename17/v5_pageForRename18',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForRename17,
      },
      {
        _id: pageIdForRename19,
        path: '/v5_pageForRename19',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        _id: pageIdForRename20,
        path: '/v5_pageForRename19/v5_pageForRename20',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForRename19,
      },
      {
        _id: pageIdForRename21,
        path: '/v5_pageForRename21',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
      },
      {
        _id: pageIdForRename22,
        path: '/v5_pageForRename21/v5_pageForRename22',
        grant: Page.GRANT_PUBLIC,
        isEmpty: true,
        parent: pageIdForRename21,
      },
      {
        _id: pageIdForRename23,
        path: '/v5_pageForRename21/v5_pageForRename22/v5_pageForRename23',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForRename22,
      },
      {
        _id: pageIdForRename24,
        path: '/v5_pageForRename24',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdForRename25,
        path: '/v5_pageForRename25',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdForRename26,
        path: '/v5_pageForRename26',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        descendantCount: 0,
      },
      {
        _id: pageIdForRename27,
        path: '/v5_pageForRename27',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdForRename28,
        path: '/v5_pageForRename27/v5_pageForRename28',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForRename27,
        descendantCount: 0,
      },
      {
        _id: pageIdForRename29,
        path: '/v5_pageForRename29',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        descendantCount: 1,
      },
      {
        _id: pageIdForRename30,
        path: '/v5_pageForRename29/v5_pageForRename30',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForRename29,
        descendantCount: 0,
      },
    ]);

    await PageOperation.insertMany([
      {
        _id: pageOpId1,
        actionType: 'Rename',
        actionStage: 'Sub',
        fromPath: '/v5_pageForRename30',
        toPath: '/v5_pageForRename29/v5_pageForRename30',
        page: {
          _id: pageIdForRename30,
          parent: rootPage._id,
          descendantCount: 0,
          isEmpty: false,
          path: '/v5_pageForRename30',
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
        activityParameters: {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
        unprocessableExpiryDate: null,
      },
    ]);

    /*
     * Duplicate
     */
    // page ids
    const pageIdForDuplicate1 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate2 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate3 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate4 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate5 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate6 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate7 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate8 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate9 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate10 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate11 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate12 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate13 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate14 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate15 = new mongoose.Types.ObjectId();
    const pageIdForDuplicate16 = new mongoose.Types.ObjectId();

    // revision ids
    const revisionIdForDuplicate1 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate2 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate3 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate4 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate5 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate6 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate7 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate8 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate9 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate10 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate11 = new mongoose.Types.ObjectId();
    const revisionIdForDuplicate12 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageIdForDuplicate1,
        path: '/v5_PageForDuplicate1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        revision: revisionIdForDuplicate1,
      },
      {
        _id: pageIdForDuplicate2,
        path: '/v5_PageForDuplicate2',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        _id: pageIdForDuplicate3,
        path: '/v5_PageForDuplicate2/v5_ChildForDuplicate2',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDuplicate2,
        revision: revisionIdForDuplicate2,
      },
      {
        _id: pageIdForDuplicate4,
        path: '/v5_PageForDuplicate3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        revision: revisionIdForDuplicate3,
      },
      {
        _id: pageIdForDuplicate5,
        path: '/v5_PageForDuplicate3/v5_Child_1_ForDuplicate3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDuplicate4,
        revision: revisionIdForDuplicate4,
      },
      {
        _id: pageIdForDuplicate6,
        path: '/v5_PageForDuplicate3/v5_Child_2_ForDuplicate3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDuplicate4,
        revision: revisionIdForDuplicate5,
      },
      {
        _id: pageIdForDuplicate7,
        path: '/v5_PageForDuplicate4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        revision: revisionIdForDuplicate6,
      },
      {
        _id: pageIdForDuplicate8,
        path: '/v5_PageForDuplicate4/v5_empty_PageForDuplicate4',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdForDuplicate7,
        isEmpty: true,
      },
      {
        _id: pageIdForDuplicate9,
        path: '/v5_PageForDuplicate4/v5_empty_PageForDuplicate4/v5_grandchild_PageForDuplicate4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDuplicate8,
        revision: revisionIdForDuplicate7,
      },
      {
        _id: pageIdForDuplicate10,
        path: '/v5_PageForDuplicate5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        revision: revisionIdForDuplicate8,
      },
      {
        _id: pageIdForDuplicate11,
        path: '/v5_PageForDuplicate6',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        revision: revisionIdForDuplicate9,
      },
      {
        _id: pageIdForDuplicate13,
        path: '/v5_empty_PageForDuplicate7',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
      {
        _id: pageIdForDuplicate14,
        path: '/v5_empty_PageForDuplicate7/v5_child_PageForDuplicate7',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDuplicate13,
        revision: revisionIdForDuplicate11,
      },
      {
        _id: pageIdForDuplicate15,
        path: '/v5_empty_PageForDuplicate7/v5_child_PageForDuplicate7/v5_grandchild_PageForDuplicate7',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDuplicate14,
        revision: revisionIdForDuplicate12,
      },
      {
        _id: pageIdForDuplicate16,
        path: '/v5_PageForDuplicate16',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        isEmpty: true,
      },
    ]);

    await Revision.insertMany([
      {
        _id: revisionIdForDuplicate1,
        body: 'body1',
        format: 'markdown',
        pageId: pageIdForDuplicate1,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate2,
        body: 'body3',
        format: 'markdown',
        pageId: pageIdForDuplicate3,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate3,
        body: 'parent_page_body4',
        format: 'markdown',
        pageId: pageIdForDuplicate4,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate4,
        body: 'revision_id_4_child_page_body',
        format: 'markdown',
        pageId: pageIdForDuplicate5,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate5,
        body: 'revision_id_5_child_page_body',
        format: 'markdown',
        pageId: pageIdForDuplicate6,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate6,
        body: '/v5_PageForDuplicate4',
        format: 'markdown',
        pageId: pageIdForDuplicate7,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate7,
        body: '/v5_PageForDuplicate4/v5_empty_PageForDuplicate4/v5_grandchild_PageForDuplicate4',
        format: 'markdown',
        pageId: pageIdForDuplicate9,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate8,
        body: '/v5_PageForDuplicate5',
        format: 'markdown',
        pageId: pageIdForDuplicate10,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate9,
        body: '/v5_PageForDuplicate6',
        format: 'markdown',
        pageId: pageIdForDuplicate11,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate10,
        body: '/v5_PageForDuplicate6',
        format: 'comment',
        pageId: pageIdForDuplicate12,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate11,
        body: '/v5_child_PageForDuplicate7',
        format: 'markdown',
        pageId: pageIdForDuplicate14,
        author: dummyUser1,
      },
      {
        _id: revisionIdForDuplicate12,
        body: '/v5_grandchild_PageForDuplicate7',
        format: 'markdown',
        pageId: pageIdForDuplicate15,
        author: dummyUser1,
      },
    ]);
    const tagForDuplicate1 = new mongoose.Types.ObjectId();
    const tagForDuplicate2 = new mongoose.Types.ObjectId();

    await Tag.insertMany([
      { _id: tagForDuplicate1, name: 'duplicate_Tag1' },
      { _id: tagForDuplicate2, name: 'duplicate_Tag2' },
    ]);

    await PageTagRelation.insertMany([
      { relatedPage: pageIdForDuplicate10, relatedTag: tagForDuplicate1 },
      { relatedPage: pageIdForDuplicate10._id, relatedTag: tagForDuplicate2 },
    ]);

    await Comment.insertMany([
      {
        commentPosition: -1,
        page: pageIdForDuplicate11,
        creator: dummyUser1._id,
        revision: revisionIdForDuplicate10,
        comment: 'this is comment',
      },
    ]);

    /**
     * Delete
     */
    const pageIdForDelete1 = new mongoose.Types.ObjectId();
    const pageIdForDelete2 = new mongoose.Types.ObjectId();
    const pageIdForDelete3 = new mongoose.Types.ObjectId();
    const pageIdForDelete4 = new mongoose.Types.ObjectId();
    const pageIdForDelete5 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        path: '/trash/v5_PageForDelete1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        status: Page.STATUS_DELETED,
      },
      {
        path: '/v5_PageForDelete2',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDelete1,
        path: '/v5_PageForDelete3',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDelete2,
        path: '/v5_PageForDelete3/v5_PageForDelete4',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdForDelete1,
        status: Page.STATUS_PUBLISHED,
        isEmpty: true,
      },
      {
        path: '/v5_PageForDelete3/v5_PageForDelete4/v5_PageForDelete5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDelete2,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDelete3,
        path: '/v5_PageForDelete6',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDelete4,
        path: '/user',
        grant: Page.GRANT_PUBLIC,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
        isEmpty: true,
      },
      {
        _id: pageIdForDelete5,
        path: '/user/v5DummyUser1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDelete4,
        status: Page.STATUS_PUBLISHED,
      },
    ]);

    const tagIdForDelete1 = new mongoose.Types.ObjectId();
    const tagIdForDelete2 = new mongoose.Types.ObjectId();

    await Tag.insertMany([
      { _id: tagIdForDelete1, name: 'TagForDelete1' },
      { _id: tagIdForDelete2, name: 'TagForDelete2' },
    ]);

    await PageTagRelation.insertMany([
      { relatedPage: pageIdForDelete3, relatedTag: tagIdForDelete1 },
      { relatedPage: pageIdForDelete3, relatedTag: tagIdForDelete2 },
    ]);

    /**
     * Delete completely
     */
    const pageIdForDeleteCompletely1 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely2 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely3 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely4 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely5 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely6 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely7 = new mongoose.Types.ObjectId();
    const pageIdForDeleteCompletely8 = new mongoose.Types.ObjectId();

    const revisionIdForDeleteCompletely1 = new mongoose.Types.ObjectId();
    const revisionIdForDeleteCompletely2 = new mongoose.Types.ObjectId();
    const revisionIdForDeleteCompletely3 = new mongoose.Types.ObjectId();
    const revisionIdForDeleteCompletely4 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageIdForDeleteCompletely1,
        path: '/v5_PageForDeleteCompletely1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDeleteCompletely2,
        path: '/v5_PageForDeleteCompletely2',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDeleteCompletely3,
        path: '/v5_PageForDeleteCompletely2/v5_PageForDeleteCompletely3',
        grant: Page.GRANT_PUBLIC,
        parent: pageIdForDeleteCompletely2,
        status: Page.STATUS_PUBLISHED,
        isEmpty: true,
      },
      {
        _id: pageIdForDeleteCompletely4,
        path: '/v5_PageForDeleteCompletely2/v5_PageForDeleteCompletely3/v5_PageForDeleteCompletely4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDeleteCompletely3,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDeleteCompletely5,
        path: '/trash/v5_PageForDeleteCompletely5',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdForDeleteCompletely6,
        path: '/v5_PageForDeleteCompletely6',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDeleteCompletely7,
        path: '/v5_PageForDeleteCompletely6/v5_PageForDeleteCompletely7',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDeleteCompletely6,
        status: Page.STATUS_PUBLISHED,
      },
      {
        _id: pageIdForDeleteCompletely8,
        path: '/v5_PageForDeleteCompletely6/v5_PageForDeleteCompletely7/v5_PageForDeleteCompletely8',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        parent: pageIdForDeleteCompletely7,
        status: Page.STATUS_PUBLISHED,
      },
    ]);

    await Revision.insertMany([
      {
        _id: revisionIdForDeleteCompletely1,
        format: 'markdown',
        pageId: pageIdForDeleteCompletely2,
        body: 'pageIdForDeleteCompletely2',
      },
      {
        _id: revisionIdForDeleteCompletely2,
        format: 'markdown',
        pageId: pageIdForDeleteCompletely4,
        body: 'pageIdForDeleteCompletely4',
      },
      {
        _id: revisionIdForDeleteCompletely3,
        format: 'markdown',
        pageId: pageIdForDeleteCompletely5,
        body: 'pageIdForDeleteCompletely5',
      },
      {
        _id: revisionIdForDeleteCompletely4,
        format: 'markdown',
        pageId: pageIdForDeleteCompletely2,
        body: 'comment_pageIdForDeleteCompletely3',
      },
    ]);

    const tagForDeleteCompletely1 = new mongoose.Types.ObjectId();
    const tagForDeleteCompletely2 = new mongoose.Types.ObjectId();
    await Tag.insertMany([
      { name: 'TagForDeleteCompletely1' },
      { name: 'TagForDeleteCompletely2' },
    ]);

    await PageTagRelation.insertMany([
      {
        relatedPage: pageIdForDeleteCompletely2,
        relatedTag: tagForDeleteCompletely1,
      },
      {
        relatedPage: pageIdForDeleteCompletely4,
        relatedTag: tagForDeleteCompletely2,
      },
    ]);

    await Bookmark.insertMany([
      {
        page: pageIdForDeleteCompletely2,
        user: dummyUser1._id,
      },
      {
        page: pageIdForDeleteCompletely2,
        user: dummyUser2._id,
      },
    ]);

    await Comment.insertMany([
      {
        commentPosition: -1,
        page: pageIdForDeleteCompletely2,
        creator: dummyUser1._id,
        revision: revisionIdForDeleteCompletely4,
        comment: 'comment_ForDeleteCompletely4',
      },
    ]);

    await PageRedirect.insertMany([
      {
        fromPath: '/from/v5_PageForDeleteCompletely2',
        toPath: '/v5_PageForDeleteCompletely2',
      },
      {
        fromPath:
          '/from/v5_PageForDeleteCompletely2/v5_PageForDeleteCompletely3/v5_PageForDeleteCompletely4',
        toPath:
          '/v5_PageForDeleteCompletely2/v5_PageForDeleteCompletely3/v5_PageForDeleteCompletely4',
      },
    ]);

    await ShareLink.insertMany([
      {
        relatedPage: pageIdForDeleteCompletely2,
        expiredAt: null,
        description: 'sharlink_v5PageForDeleteCompletely2',
      },
      {
        relatedPage: pageIdForDeleteCompletely4,
        expiredAt: null,
        description: 'sharlink_v5PageForDeleteCompletely4',
      },
    ]);

    /**
     * Revert
     */
    const pageIdForRevert1 = new mongoose.Types.ObjectId();
    const pageIdForRevert2 = new mongoose.Types.ObjectId();
    const pageIdForRevert3 = new mongoose.Types.ObjectId();

    const revisionIdForRevert1 = new mongoose.Types.ObjectId();
    const revisionIdForRevert2 = new mongoose.Types.ObjectId();
    const revisionIdForRevert3 = new mongoose.Types.ObjectId();

    await Page.insertMany([
      {
        _id: pageIdForRevert1,
        path: '/trash/v5_revert1',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        revision: revisionIdForRevert1,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdForRevert2,
        path: '/trash/v5_revert2',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        revision: revisionIdForRevert2,
        status: Page.STATUS_DELETED,
      },
      {
        _id: pageIdForRevert3,
        path: '/trash/v5_revert2/v5_revert3/v5_revert4',
        grant: Page.GRANT_PUBLIC,
        creator: dummyUser1,
        lastUpdateUser: dummyUser1._id,
        revision: revisionIdForRevert3,
        status: Page.STATUS_DELETED,
      },
    ]);

    await Revision.insertMany([
      {
        _id: revisionIdForRevert1,
        pageId: pageIdForRevert1,
        body: 'revert1',
        format: 'comment',
        author: dummyUser1,
      },
      {
        _id: revisionIdForRevert2,
        pageId: pageIdForRevert2,
        body: 'revert2',
        format: 'comment',
        author: dummyUser1,
      },
      {
        _id: revisionIdForRevert3,
        pageId: pageIdForRevert3,
        body: 'revert3',
        format: 'comment',
        author: dummyUser1,
      },
    ]);

    const tagIdRevert1 = new mongoose.Types.ObjectId();
    await Tag.insertMany([{ _id: tagIdRevert1, name: 'revertTag1' }]);

    await PageTagRelation.insertMany([
      {
        relatedPage: pageIdForRevert1,
        relatedTag: tagIdRevert1,
        isPageTrashed: true,
      },
    ]);
  });

  describe('create', () => {
    test('Should create single page', async () => {
      const isGrantNormalizedSpy = jest.spyOn(
        crowi.pageGrantService,
        'isGrantNormalized',
      );
      const page = await create('/v5_create1', 'create1', dummyUser1, {});
      expect(page).toBeTruthy();
      expect(page.parent).toStrictEqual(rootPage._id);
      // isGrantNormalized is called when GRANT PUBLIC
      expect(isGrantNormalizedSpy).toBeCalledTimes(1);
    });

    test('Should create empty-child and non-empty grandchild', async () => {
      const isGrantNormalizedSpy = jest.spyOn(
        crowi.pageGrantService,
        'isGrantNormalized',
      );
      const grandchildPage = await create(
        '/v5_empty_create2/v5_create_3',
        'grandchild',
        dummyUser1,
        {},
      );
      const childPage = await Page.findOne({ path: '/v5_empty_create2' });

      expect(childPage?.isEmpty).toBe(true);
      expect(grandchildPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(childPage?.parent).toStrictEqual(rootPage._id);
      expect(grandchildPage?.parent).toStrictEqual(childPage?._id);
      // isGrantNormalized is called when GRANT PUBLIC
      expect(isGrantNormalizedSpy).toBeCalledTimes(1);
    });

    test('Should create on empty page', async () => {
      const isGrantNormalizedSpy = jest.spyOn(
        crowi.pageGrantService,
        'isGrantNormalized',
      );
      const beforeCreatePage = await Page.findOne({
        path: '/v5_empty_create_4',
      });
      expect(beforeCreatePage?.isEmpty).toBe(true);

      const childPage = await create(
        '/v5_empty_create_4',
        'body',
        dummyUser1,
        {},
      );
      const grandchildPage = await Page.findOne({ parent: childPage._id });

      expect(childPage).toBeTruthy();
      expect(childPage.isEmpty).toBe(false);
      expect(childPage.revision.body).toBe('body');
      expect(grandchildPage).toBeTruthy();
      expect(childPage.parent).toStrictEqual(rootPage._id);
      expect(grandchildPage?.parent).toStrictEqual(childPage._id);
      // isGrantNormalized is called when GRANT PUBLIC
      expect(isGrantNormalizedSpy).toBeCalledTimes(1);
    });
  });

  describe('create by system', () => {
    test('Should create single page by system', async () => {
      const isGrantNormalizedSpy = jest.spyOn(
        crowi.pageGrantService,
        'isGrantNormalized',
      );
      const page = await crowi.pageService.forceCreateBySystem(
        '/v5_create_by_system1',
        'create_by_system1',
        {},
      );
      expect(page).toBeTruthy();
      expect(page.parent).toStrictEqual(rootPage._id);
      // isGrantNormalized is not called when create by system
      expect(isGrantNormalizedSpy).toBeCalledTimes(0);
    });

    test('Should create empty-child and non-empty grandchild', async () => {
      const isGrantNormalizedSpy = jest.spyOn(
        crowi.pageGrantService,
        'isGrantNormalized',
      );
      const grandchildPage = await crowi.pageService.forceCreateBySystem(
        '/v5_empty_create_by_system2/v5_create_by_system3',
        'grandchild',
        {},
      );
      const childPage = await Page.findOne({
        path: '/v5_empty_create_by_system2',
      });

      expect(childPage?.isEmpty).toBe(true);
      expect(grandchildPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(childPage?.parent).toStrictEqual(rootPage._id);
      expect(grandchildPage?.parent).toStrictEqual(childPage?._id);
      // isGrantNormalized is not called when create by system
      expect(isGrantNormalizedSpy).toBeCalledTimes(0);
    });

    test('Should create on empty page', async () => {
      const isGrantNormalizedSpy = jest.spyOn(
        crowi.pageGrantService,
        'isGrantNormalized',
      );
      const beforeCreatePage = await Page.findOne({
        path: '/v5_empty_create_by_system4',
      });
      expect(beforeCreatePage?.isEmpty).toBe(true);

      const childPage = await crowi.pageService.forceCreateBySystem(
        '/v5_empty_create_by_system4',
        'body',
        {},
      );
      const grandchildPage = await Page.findOne({ parent: childPage._id });

      expect(childPage).toBeTruthy();
      expect(childPage.isEmpty).toBe(false);
      expect(childPage.revision.body).toBe('body');
      expect(grandchildPage).toBeTruthy();
      expect(childPage.parent).toStrictEqual(rootPage._id);
      expect(grandchildPage?.parent).toStrictEqual(childPage._id);
      // isGrantNormalized is not called when create by system
      expect(isGrantNormalizedSpy).toBeCalledTimes(0);
    });
  });

  describe('Rename', () => {
    const renamePage = async (
      page,
      newPagePath,
      user,
      options,
      activityParameters?,
    ) => {
      // mock return value
      const mockedRenameSubOperation = jest
        .spyOn(crowi.pageService, 'renameSubOperation')
        .mockReturnValue(null);
      const renamedPage = await crowi.pageService.renamePage(
        page,
        newPagePath,
        user,
        options,
        activityParameters,
      );

      // retrieve the arguments passed when calling method renameSubOperation inside renamePage method
      const argsForRenameSubOperation = mockedRenameSubOperation.mock.calls[0];

      // restores the original implementation
      mockedRenameSubOperation.mockRestore();

      // rename descendants
      await crowi.pageService.renameSubOperation(
        ...(argsForRenameSubOperation as Parameters<
          typeof crowi.pageService.renameSubOperation
        >),
      );

      return renamedPage;
    };

    /**
     * This function only execute renameMainOperation. renameSubOperation is basically omitted(only return null)
     */
    const renameMainOperation = async (
      page,
      newPagePath,
      user,
      options,
      activityParameters?,
    ) => {
      // create page operation from target page
      const pageOp = await PageOperation.create({
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Main,
        page,
        user,
        fromPath: page.path,
        toPath: newPagePath,
        options,
      });

      // mock return value
      const mockedRenameSubOperation = jest
        .spyOn(crowi.pageService, 'renameSubOperation')
        .mockReturnValue(null);
      const renamedPage = await crowi.pageService.renameMainOperation(
        page,
        newPagePath,
        user,
        options,
        pageOp._id,
        activityParameters,
      );

      // restores the original implementation
      mockedRenameSubOperation.mockRestore();

      return renamedPage;
    };

    test('Should NOT rename top page', async () => {
      expect(rootPage).toBeTruthy();
      let isThrown = false;
      try {
        await crowi.pageService.renamePage(
          rootPage,
          '/new_root',
          dummyUser1,
          {},
          {
            ip: '::ffff:127.0.0.1',
            endpoint: '/_api/v3/pages/rename',
          },
        );
      } catch (err) {
        isThrown = true;
      }

      expect(isThrown).toBe(true);
    });

    test('Should rename/move to under non-empty page', async () => {
      const parentPage = await Page.findOne({ path: '/v5_ParentForRename1' });
      const childPage = await Page.findOne({ path: '/v5_ChildForRename1' });
      expect(childPage).toBeTruthy();
      expect(parentPage).toBeTruthy();

      const newPath = '/v5_ParentForRename1/renamedChildForRename1';
      const renamedPage = await renamePage(
        childPage,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );
      const childPageBeforeRename = await Page.findOne({
        path: '/v5_ChildForRename1',
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(renamedPage.parent).toStrictEqual(parentPage?._id);
      expect(childPageBeforeRename).toBeNull();
    });

    test('Should rename/move to under empty page', async () => {
      const parentPage = await Page.findOne({ path: '/v5_ParentForRename2' });
      const childPage = await Page.findOne({ path: '/v5_ChildForRename2' });
      expect(childPage).toBeTruthy();
      expect(parentPage).toBeTruthy();
      expect(parentPage?.isEmpty).toBe(true);

      const newPath = '/v5_ParentForRename2/renamedChildForRename2';
      const renamedPage = await renamePage(
        childPage,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );
      const childPageBeforeRename = await Page.findOne({
        path: '/v5_ChildForRename2',
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(parentPage?.isEmpty).toBe(true);
      expect(renamedPage.parent).toStrictEqual(parentPage?._id);
      expect(childPageBeforeRename).toBeNull();
    });

    test('Should rename/move with option updateMetadata: true', async () => {
      const parentPage = await Page.findOne({ path: '/v5_ParentForRename3' });
      const childPage = await Page.findOne({ path: '/v5_ChildForRename3' });
      expect(childPage).toBeTruthy();
      expect(parentPage).toBeTruthy();
      expect(childPage?.lastUpdateUser).toStrictEqual(dummyUser1._id);

      const newPath = '/v5_ParentForRename3/renamedChildForRename3';
      const oldUpdateAt = childPage?.updatedAt;
      const renamedPage = await renamePage(
        childPage,
        newPath,
        dummyUser2,
        { updateMetadata: true },
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(renamedPage.parent).toStrictEqual(parentPage?._id);
      expect(renamedPage.lastUpdateUser).toStrictEqual(dummyUser2._id);
      expect(renamedPage.updatedAt.getFullYear()).toBeGreaterThan(
        oldUpdateAt?.getFullYear(),
      );
    });

    test('Should move with option createRedirectPage: true', async () => {
      const parentPage = await Page.findOne({ path: '/v5_ParentForRename4' });
      const childPage = await Page.findOne({ path: '/v5_ChildForRename4' });
      expect(parentPage).toBeTruthy();
      expect(childPage).toBeTruthy();

      const oldPath = childPage?.path;
      const newPath = '/v5_ParentForRename4/renamedChildForRename4';
      const renamedPage = await renamePage(
        childPage,
        newPath,
        dummyUser2,
        { createRedirectPage: true },
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );
      const pageRedirect = await PageRedirect.findOne({
        fromPath: oldPath,
        toPath: renamedPage.path,
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(renamedPage.parent).toStrictEqual(parentPage?._id);
      expect(pageRedirect).toBeTruthy();
    });

    test('Should rename/move with descendants', async () => {
      const parentPage = await Page.findOne({ path: '/v5_ParentForRename5' });
      const childPage = await Page.findOne({ path: '/v5_ChildForRename5' });
      const grandchild = await Page.findOne({
        parent: childPage?._id,
        path: '/v5_ChildForRename5/v5_GrandchildForRename5',
      });

      expect(parentPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(grandchild).toBeTruthy();

      const newPath = '/v5_ParentForRename5/renamedChildForRename5';
      const renamedPage = await renamePage(
        childPage,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );
      // find child of renamed page
      const renamedGrandchild = await Page.findOne({ parent: renamedPage._id });
      const childPageBeforeRename = await Page.findOne({
        path: '/v5_ChildForRename5',
      });
      const grandchildBeforeRename = await Page.findOne({
        path: grandchild?.path,
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(renamedPage.parent).toStrictEqual(parentPage?._id);
      expect(childPageBeforeRename).toBeNull();
      expect(grandchildBeforeRename).toBeNull();
      // grandchild's parent should be the renamed page
      expect(renamedGrandchild?.parent).toStrictEqual(renamedPage._id);
      expect(renamedGrandchild?.path).toBe(
        '/v5_ParentForRename5/renamedChildForRename5/v5_GrandchildForRename5',
      );
    });

    test('Should rename/move empty page', async () => {
      const parentPage = await Page.findOne({ path: '/v5_ParentForRename7' });
      const childPage = await Page.findOne({
        path: '/v5_ChildForRename7',
        isEmpty: true,
      });
      const grandchild = await Page.findOne({
        parent: childPage?._id,
        path: '/v5_ChildForRename7/v5_GrandchildForRename7',
      });

      expect(parentPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(grandchild).toBeTruthy();

      const newPath = '/v5_ParentForRename7/renamedChildForRename7';
      const renamedPage = await renamePage(
        childPage,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );
      const grandchildAfterRename = await Page.findOne({
        parent: renamedPage._id,
      });
      const grandchildBeforeRename = await Page.findOne({
        path: '/v5_ChildForRename7/v5_GrandchildForRename7',
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(renamedPage.isEmpty).toBe(true);
      expect(renamedPage.parent).toStrictEqual(parentPage?._id);
      expect(grandchildBeforeRename).toBeNull();
      // grandchild's parent should be renamed page
      expect(grandchildAfterRename?.parent).toStrictEqual(renamedPage._id);
      expect(grandchildAfterRename?.path).toBe(
        '/v5_ParentForRename7/renamedChildForRename7/v5_GrandchildForRename7',
      );
    });
    test('Should NOT rename/move with existing path', async () => {
      const page = await Page.findOne({ path: '/v5_ParentForRename8' });
      expect(page).toBeTruthy();

      const newPath = '/v5_ParentForRename9';
      let isThrown = false;
      try {
        await renamePage(
          page,
          newPath,
          dummyUser1,
          {},
          {
            ip: '::ffff:127.0.0.1',
            endpoint: '/_api/v3/pages/rename',
          },
        );
      } catch (err) {
        isThrown = true;
      }

      expect(isThrown).toBe(true);
    });
    test('Should rename/move to the path that exists as an empty page', async () => {
      const page = await Page.findOne({ path: '/v5_ParentForRename10' });
      const pageDistination = await Page.findOne({
        path: '/v5_ParentForRename11',
        isEmpty: true,
      });
      expect(page).toBeTruthy();
      expect(pageDistination).toBeTruthy();
      expect(pageDistination?.isEmpty).toBe(true);

      const newPath = '/v5_ParentForRename11';
      const renamedPage = await renamePage(
        page,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(renamedPage.path).toBe(newPath);
      expect(renamedPage.isEmpty).toBe(false);
      expect(renamedPage._id).toStrictEqual(page?._id);
    });
    test('Rename non-empty page path to its descendant non-empty page path', async () => {
      const initialPathForPage1 = '/v5_pageForRename17';
      const initialPathForPage2 = '/v5_pageForRename17/v5_pageForRename18';
      const page1 = await Page.findOne({
        path: initialPathForPage1,
        isEmpty: false,
      });
      const page2 = await Page.findOne({
        path: initialPathForPage2,
        isEmpty: false,
        parent: page1?._id,
      });

      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();

      const newParentalPath = '/v5_pageForRename17/v5_pageForRename18';
      const newPath = newParentalPath + page1?.path;
      await renamePage(
        page1,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );

      const renamedPage = await Page.findOne({
        path: newParentalPath + initialPathForPage1,
      });
      const renamedPageChild = await Page.findOne({
        path: newParentalPath + initialPathForPage2,
      });
      const newlyCreatedEmptyPage1 = await Page.findOne({
        path: '/v5_pageForRename17',
      });
      const newlyCreatedEmptyPage2 = await Page.findOne({
        path: '/v5_pageForRename17/v5_pageForRename18',
      });

      expect(renamedPage).toBeTruthy();
      expect(renamedPageChild).toBeTruthy();
      expect(newlyCreatedEmptyPage1).toBeTruthy();
      expect(newlyCreatedEmptyPage2).toBeTruthy();

      // check parent
      expect(newlyCreatedEmptyPage1?.parent).toStrictEqual(rootPage._id);
      expect(newlyCreatedEmptyPage2?.parent).toStrictEqual(
        newlyCreatedEmptyPage1?._id,
      );
      expect(renamedPage?.parent).toStrictEqual(newlyCreatedEmptyPage2?._id);
      expect(renamedPageChild?.parent).toStrictEqual(renamedPage?._id);

      // check isEmpty
      expect(newlyCreatedEmptyPage1?.isEmpty).toBeTruthy();
      expect(newlyCreatedEmptyPage2?.isEmpty).toBeTruthy();
      expect(renamedPage?.isEmpty).toBe(false);
      expect(renamedPageChild?.isEmpty).toBe(false);
    });

    test('Rename empty page path to its descendant non-empty page path', async () => {
      const initialPathForPage1 = '/v5_pageForRename19';
      const initialPathForPage2 = '/v5_pageForRename19/v5_pageForRename20';
      const page1 = await Page.findOne({
        path: initialPathForPage1,
        isEmpty: true,
      });
      const page2 = await Page.findOne({
        path: initialPathForPage2,
        isEmpty: false,
        parent: page1?._id,
      });

      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();

      const newParentalPath = '/v5_pageForRename19/v5_pageForRename20';
      const newPath = newParentalPath + page1?.path;
      await renamePage(
        page1,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );

      const renamedPage = await Page.findOne({
        path: newParentalPath + initialPathForPage1,
      });
      const renamedPageChild = await Page.findOne({
        path: newParentalPath + initialPathForPage2,
      });
      const newlyCreatedEmptyPage1 = await Page.findOne({
        path: '/v5_pageForRename19',
      });
      const newlyCreatedEmptyPage2 = await Page.findOne({
        path: '/v5_pageForRename19/v5_pageForRename20',
      });

      expect(renamedPage).toBeTruthy();
      expect(renamedPageChild).toBeTruthy();
      expect(newlyCreatedEmptyPage1).toBeTruthy();
      expect(newlyCreatedEmptyPage2).toBeTruthy();

      // check parent
      expect(newlyCreatedEmptyPage1?.parent).toStrictEqual(rootPage._id);
      expect(newlyCreatedEmptyPage2?.parent).toStrictEqual(
        newlyCreatedEmptyPage1?._id,
      );
      expect(renamedPage?.parent).toStrictEqual(newlyCreatedEmptyPage2?._id);
      expect(renamedPageChild?.parent).toStrictEqual(renamedPage?._id);

      // check isEmpty
      expect(newlyCreatedEmptyPage1?.isEmpty).toBeTruthy();
      expect(newlyCreatedEmptyPage2?.isEmpty).toBeTruthy();
      expect(renamedPage?.isEmpty).toBeTruthy();
      expect(renamedPageChild?.isEmpty).toBe(false);
    });

    test('Rename the path of a non-empty page to its grandchild page path that has an empty parent', async () => {
      const initialPathForPage1 = '/v5_pageForRename21';
      const initialPathForPage2 = '/v5_pageForRename21/v5_pageForRename22';
      const initialPathForPage3 =
        '/v5_pageForRename21/v5_pageForRename22/v5_pageForRename23';
      const page1 = await Page.findOne({
        path: initialPathForPage1,
        isEmpty: false,
      });
      const page2 = await Page.findOne({
        path: initialPathForPage2,
        isEmpty: true,
        parent: page1?._id,
      });
      const page3 = await Page.findOne({
        path: initialPathForPage3,
        isEmpty: false,
        parent: page2?._id,
      });

      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeTruthy();

      const newParentalPath =
        '/v5_pageForRename21/v5_pageForRename22/v5_pageForRename23';
      const newPath = newParentalPath + page1?.path;

      await renamePage(
        page1,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );

      const renamedPage = await Page.findOne({
        path: newParentalPath + initialPathForPage1,
      });
      const renamedPageChild = await Page.findOne({
        path: newParentalPath + initialPathForPage2,
      });
      const renamedPageGrandchild = await Page.findOne({
        path: newParentalPath + initialPathForPage3,
      });

      const newlyCreatedEmptyPage1 = await Page.findOne({
        path: '/v5_pageForRename21',
      });
      const newlyCreatedEmptyPage2 = await Page.findOne({
        path: '/v5_pageForRename21/v5_pageForRename22',
      });
      const newlyCreatedEmptyPage3 = await Page.findOne({
        path: '/v5_pageForRename21/v5_pageForRename22/v5_pageForRename23',
      });

      expect(renamedPage).toBeTruthy();
      expect(renamedPageChild).toBeTruthy();
      expect(renamedPageGrandchild).toBeTruthy();
      expect(newlyCreatedEmptyPage1).toBeTruthy();
      expect(newlyCreatedEmptyPage2).toBeTruthy();
      expect(newlyCreatedEmptyPage3).toBeTruthy();

      // check parent
      expect(newlyCreatedEmptyPage1?.parent).toStrictEqual(rootPage._id);
      expect(newlyCreatedEmptyPage2?.parent).toStrictEqual(
        newlyCreatedEmptyPage1?._id,
      );
      expect(newlyCreatedEmptyPage3?.parent).toStrictEqual(
        newlyCreatedEmptyPage2?._id,
      );
      expect(renamedPage?.parent).toStrictEqual(newlyCreatedEmptyPage3?._id);
      expect(renamedPageChild?.parent).toStrictEqual(renamedPage?._id);
      expect(renamedPageGrandchild?.parent).toStrictEqual(
        renamedPageChild?._id,
      );

      // check isEmpty
      expect(newlyCreatedEmptyPage1?.isEmpty).toBeTruthy();
      expect(newlyCreatedEmptyPage2?.isEmpty).toBeTruthy();
      expect(newlyCreatedEmptyPage3?.isEmpty).toBeTruthy();
      expect(renamedPage?.isEmpty).toBe(false);
      expect(renamedPageChild?.isEmpty).toBeTruthy();
      expect(renamedPageGrandchild?.isEmpty).toBe(false);
    });

    test('should add 1 descendantCount to parent page in MainOperation', async () => {
      // paths before renaming
      const _path0 = '/v5_pageForRename24'; // out of renaming scope
      const _path1 = '/v5_pageForRename25'; // not renamed yet

      // paths after renaming
      const path0 = '/v5_pageForRename24';
      const path1 = '/v5_pageForRename24/v5_pageForRename25';

      // new path:  same as path1
      const newPath = '/v5_pageForRename24/v5_pageForRename25';

      // pages
      const _page0 = await Page.findOne({ path: _path0 });
      const _page1 = await Page.findOne({ path: _path1 });

      expect(_page0).toBeTruthy();
      expect(_page1).toBeTruthy();
      expect(_page0?.descendantCount).toBe(0);
      expect(_page1?.descendantCount).toBe(0);

      await renameMainOperation(_page1, newPath, dummyUser1, {});

      const page0 = await Page.findById(_page0?._id); // new parent
      const page1 = await Page.findById(_page1?._id); // renamed one
      expect(page0).toBeTruthy();
      expect(page1).toBeTruthy();

      expect(page0?.path).toBe(path0);
      expect(page1?.path).toBe(path1); // renamed
      expect(page0?.descendantCount).toBe(1); // originally 0, +1 in Main.
      expect(page1?.descendantCount).toBe(0);

      // cleanup
      await PageOperation.findOneAndDelete({ fromPath: _path1 });
    });

    test('should subtract 1 descendantCount from a new parent page in renameSubOperation', async () => {
      // paths before renaming
      const _path0 = '/v5_pageForRename29'; // out of renaming scope
      const _path1 = '/v5_pageForRename29/v5_pageForRename30'; // already renamed

      // paths after renaming
      const path0 = '/v5_pageForRename29';
      const path1 = '/v5_pageForRename29/v5_pageForRename30';

      // new path:  same as path1
      const newPath = '/v5_pageForRename29/v5_pageForRename30';

      // page
      const _page0 = await Page.findOne({ path: _path0 });
      const _page1 = await Page.findOne({ path: _path1 });
      expect(_page0).toBeTruthy();
      expect(_page1).toBeTruthy();

      // page operation
      const fromPath = '/v5_pageForRename30';
      const toPath = newPath;
      const pageOperation = await PageOperation.findOne({
        _id: pageOpId1,
        fromPath,
        toPath,
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Sub,
      });
      expect(pageOperation).toBeTruthy();

      // descendantCount
      expect(_page0?.descendantCount).toBe(1);
      expect(_page1?.descendantCount).toBe(0);

      // renameSubOperation only
      await crowi.pageService.renameSubOperation(
        _page1,
        newPath,
        dummyUser1,
        {},
        _page1,
        pageOperation?._id,
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
          activityId: '62e291bc10e0ab61bd691794',
        },
      );

      // page
      const page0 = await Page.findById(_page0?._id); // new parent
      const page1 = await Page.findById(_page1?._id); // renamed one
      expect(page0).toBeTruthy();
      expect(page1).toBeTruthy();
      expect(page0?.path).toBe(path0);
      expect(page1?.path).toBe(path1); // renamed

      // descendantCount
      expect(page0?.descendantCount).toBe(0); // originally 1, -1 in Sub.
      expect(page1?.descendantCount).toBe(0);
    });

    test(`should add 1 descendantCount to the a parent page in rename(Main)Operation
    and subtract 1 descendantCount from the the parent page in rename(Sub)Operation`, async () => {
      // paths before renaming
      const _path0 = '/v5_pageForRename26'; // out of renaming scope
      const _path1 = '/v5_pageForRename27'; // not renamed yet
      const _path2 = '/v5_pageForRename27/v5_pageForRename28'; // not renamed yet

      // paths after renaming
      const path0 = '/v5_pageForRename26';
      const path1 = '/v5_pageForRename26/v5_pageForRename27';
      const path2 = '/v5_pageForRename26/v5_pageForRename27/v5_pageForRename28';

      // new path: same as path1
      const newPath = '/v5_pageForRename26/v5_pageForRename27';

      // page
      const _page0 = await Page.findOne({ path: _path0 });
      const _page1 = await Page.findOne({ path: _path1 });
      const _page2 = await Page.findOne({ path: _path2 });

      expect(_page0).toBeTruthy();
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      expect(_page0?.descendantCount).toBe(0);
      expect(_page1?.descendantCount).toBe(1);
      expect(_page2?.descendantCount).toBe(0);

      await renamePage(
        _page1,
        newPath,
        dummyUser1,
        {},
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/rename',
        },
      );

      const page0 = await Page.findById(_page0?._id); // new parent
      const page1 = await Page.findById(_page1?._id); // renamed
      const page2 = await Page.findById(_page2?._id); // renamed
      expect(page0).toBeTruthy();
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();

      expect(page0?.path).toBe(path0);
      expect(page1?.path).toBe(path1);
      expect(page2?.path).toBe(path2);
      expect(page0?.descendantCount).toBe(2); // originally 0, +1 in Main, -1 in Sub, +2 for descendants.
      expect(page1?.descendantCount).toBe(1);
      expect(page2?.descendantCount).toBe(0);

      // cleanup
      await PageOperation.findOneAndDelete({ fromPath: _path1 });
    });
  });
  describe('Duplicate', () => {
    const duplicate = async (page, newPagePath, user, isRecursively) => {
      // mock return value
      const mockedDuplicateRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'duplicateRecursivelyMainOperation')
        .mockReturnValue(null);
      const duplicatedPage = await crowi.pageService.duplicate(
        page,
        newPagePath,
        user,
        isRecursively,
        false,
      );

      // retrieve the arguments passed when calling method duplicateRecursivelyMainOperation inside duplicate method
      const argsForDuplicateRecursivelyMainOperation =
        mockedDuplicateRecursivelyMainOperation.mock.calls[0];

      // restores the original implementation
      mockedDuplicateRecursivelyMainOperation.mockRestore();

      // duplicate descendants
      if (isRecursively) {
        await crowi.pageService.duplicateRecursivelyMainOperation(
          ...(argsForDuplicateRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.duplicateRecursivelyMainOperation
          >),
        );
      }

      return duplicatedPage;
    };

    test('Should duplicate single page', async () => {
      const page = await Page.findOne({ path: '/v5_PageForDuplicate1' });
      expect(page).toBeTruthy();

      const newPagePath = '/duplicatedv5PageForDuplicate1';
      const duplicatedPage = await duplicate(
        page,
        newPagePath,
        dummyUser1,
        false,
      );

      const duplicatedRevision = await Revision.findOne({
        pageId: duplicatedPage._id,
      });
      const baseRevision = await Revision.findOne({ pageId: page?._id });

      // new path
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(duplicatedPage._id).not.toStrictEqual(page?._id);
      expect(duplicatedPage.revision).toStrictEqual(duplicatedRevision?._id);
      expect(duplicatedRevision?.body).toEqual(baseRevision?.body);
    });

    test('Should NOT duplicate single empty page', async () => {
      const page = await Page.findOne({ path: '/v5_PageForDuplicate2' });
      expect(page).toBeTruthy();

      let isThrown = false;
      let duplicatedPage: IPage | undefined;
      try {
        const newPagePath = '/duplicatedv5PageForDuplicate2';
        duplicatedPage = await duplicate(page, newPagePath, dummyUser1, false);
      } catch (err) {
        isThrown = true;
      }

      expect(duplicatedPage).toBeUndefined();
      expect(isThrown).toBe(true);
    });

    test('Should duplicate to the path that exists as an empty page', async () => {
      const page = await Page.findOne({ path: '/v5_PageForDuplicate1' });
      expect(page).toBeTruthy();

      const newPagePath = '/v5_PageForDuplicate16';
      const duplicatedPage = await duplicate(
        page,
        newPagePath,
        dummyUser1,
        false,
      );

      const duplicatedRevision = await Revision.findOne({
        pageId: duplicatedPage._id,
      });
      const baseRevision = await Revision.findOne({ pageId: page?._id });

      // new path
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(duplicatedPage._id).not.toStrictEqual(page?._id);
      expect(duplicatedPage.revision).toStrictEqual(duplicatedRevision?._id);
      expect(duplicatedRevision?.body).toEqual(baseRevision?.body);
    });

    test('Should duplicate multiple pages', async () => {
      const basePage = await Page.findOne({ path: '/v5_PageForDuplicate3' });
      const revision = await Revision.findOne({ pageId: basePage?._id });
      const childPage1 = await Page.findOne({
        path: '/v5_PageForDuplicate3/v5_Child_1_ForDuplicate3',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const childPage2 = await Page.findOne({
        path: '/v5_PageForDuplicate3/v5_Child_2_ForDuplicate3',
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const revisionForChild1 = childPage1?.revision;
      const revisionForChild2 = childPage2?.revision;
      expect(basePage).toBeTruthy();
      expect(revision).toBeTruthy();
      expect(childPage1).toBeTruthy();
      expect(childPage2).toBeTruthy();
      expect(revisionForChild1).toBeTruthy();
      expect(revisionForChild2).toBeTruthy();

      const newPagePath = '/duplicatedv5PageForDuplicate3';
      const duplicatedPage = await duplicate(
        basePage,
        newPagePath,
        dummyUser1,
        true,
      );
      const duplicatedChildPage1 = await Page.findOne({
        parent: duplicatedPage._id,
        path: '/duplicatedv5PageForDuplicate3/v5_Child_1_ForDuplicate3',
      }).populate({ path: 'revision', model: 'Revision' });
      const duplicatedChildPage2 = await Page.findOne({
        parent: duplicatedPage._id,
        path: '/duplicatedv5PageForDuplicate3/v5_Child_2_ForDuplicate3',
      }).populate({ path: 'revision', model: 'Revision' });
      const revisionForDuplicatedPage = await Revision.findOne({
        pageId: duplicatedPage._id,
      });
      const revisionBodyForDupChild1 = duplicatedChildPage1?.revision;
      const revisionBodyForDupChild2 = duplicatedChildPage2?.revision;

      expect(duplicatedPage).toBeTruthy();
      expect(duplicatedChildPage1).toBeTruthy();
      expect(duplicatedChildPage2).toBeTruthy();
      expect(revisionForDuplicatedPage).toBeTruthy();
      expect(revisionBodyForDupChild1).toBeTruthy();
      expect(revisionBodyForDupChild2).toBeTruthy();

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(duplicatedChildPage1?.path).toBe(
        '/duplicatedv5PageForDuplicate3/v5_Child_1_ForDuplicate3',
      );
      expect(duplicatedChildPage2?.path).toBe(
        '/duplicatedv5PageForDuplicate3/v5_Child_2_ForDuplicate3',
      );
    });

    test('Should duplicate multiple pages with empty child in it', async () => {
      const basePage = await Page.findOne({ path: '/v5_PageForDuplicate4' });
      const baseChild = await Page.findOne({
        parent: basePage?._id,
        isEmpty: true,
      });
      const baseGrandchild = await Page.findOne({ parent: baseChild?._id });
      expect(basePage).toBeTruthy();
      expect(baseChild).toBeTruthy();
      expect(baseGrandchild).toBeTruthy();

      const newPagePath = '/duplicatedv5PageForDuplicate4';
      const duplicatedPage = await duplicate(
        basePage,
        newPagePath,
        dummyUser1,
        true,
      );
      const duplicatedChild = await Page.findOne({
        parent: duplicatedPage._id,
      });
      const duplicatedGrandchild = await Page.findOne({
        parent: duplicatedChild?._id,
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage).toBeTruthy();
      expect(duplicatedGrandchild).toBeTruthy();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(duplicatedChild?.path).toBe(
        '/duplicatedv5PageForDuplicate4/v5_empty_PageForDuplicate4',
      );
      expect(duplicatedGrandchild?.path).toBe(
        '/duplicatedv5PageForDuplicate4/v5_empty_PageForDuplicate4/v5_grandchild_PageForDuplicate4',
      );
      expect(duplicatedChild?.isEmpty).toBe(true);
      expect(duplicatedGrandchild?.parent).toStrictEqual(duplicatedChild?._id);
      expect(duplicatedChild?.parent).toStrictEqual(duplicatedPage?._id);
    });

    test('Should duplicate tags', async () => {
      const basePage = await Page.findOne({ path: '/v5_PageForDuplicate5' });
      const tag1 = await Tag.findOne({ name: 'duplicate_Tag1' });
      const tag2 = await Tag.findOne({ name: 'duplicate_Tag2' });
      const basePageTagRelation1 = await PageTagRelation.findOne({
        relatedTag: tag1?._id,
      });
      const basePageTagRelation2 = await PageTagRelation.findOne({
        relatedTag: tag2?._id,
      });
      expect(basePage).toBeTruthy();
      expect(tag1).toBeTruthy();
      expect(tag2).toBeTruthy();
      expect(basePageTagRelation1).toBeTruthy();
      expect(basePageTagRelation2).toBeTruthy();

      const newPagePath = '/duplicatedv5PageForDuplicate5';
      const duplicatedPage = await duplicate(
        basePage,
        newPagePath,
        dummyUser1,
        false,
      );
      const duplicatedTagRelations = await PageTagRelation.find({
        relatedPage: duplicatedPage._id,
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(duplicatedTagRelations.length).toBeGreaterThanOrEqual(2);
    });

    test('Should NOT duplicate comments', async () => {
      const basePage = await Page.findOne({ path: '/v5_PageForDuplicate6' });
      const basePageComments = await Comment.find({ page: basePage?._id });
      expect(basePage).toBeTruthy();
      expect(basePageComments.length).toBeGreaterThan(0); // length > 0

      const newPagePath = '/duplicatedv5PageForDuplicate6';
      const duplicatedPage = await duplicate(
        basePage,
        newPagePath,
        dummyUser1,
        false,
      );
      const duplicatedComments = await Comment.find({
        page: duplicatedPage._id,
      });

      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(basePageComments.length).not.toBe(duplicatedComments.length);
    });

    test('Should duplicate empty page with descendants', async () => {
      const basePage = await Page.findOne({
        path: '/v5_empty_PageForDuplicate7',
      });
      const basePageChild = await Page.findOne({
        parent: basePage?._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const basePageGrandhild = await Page.findOne({
        parent: basePageChild?._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      expect(basePage).toBeTruthy();
      expect(basePageChild).toBeTruthy();
      expect(basePageGrandhild).toBeTruthy();
      expect(basePageChild?.revision).toBeTruthy();
      expect(basePageGrandhild?.revision).toBeTruthy();
      const newPagePath = '/duplicatedv5EmptyPageForDuplicate7';
      const duplicatedPage = await duplicate(
        basePage,
        newPagePath,
        dummyUser1,
        true,
      );
      const duplicatedChild = await Page.findOne({
        parent: duplicatedPage._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });
      const duplicatedGrandchild = await Page.findOne({
        parent: duplicatedChild?._id,
      }).populate<{ revision: IRevisionDocument }>({
        path: 'revision',
        model: 'Revision',
      });

      expect(duplicatedPage).toBeTruthy();
      expect(duplicatedChild).toBeTruthy();
      expect(duplicatedGrandchild).toBeTruthy();
      expect(duplicatedChild?.revision).toBeTruthy();
      expect(duplicatedGrandchild?.revision).toBeTruthy();
      expect(generalXssFilterProcessSpy).toHaveBeenCalled();
      expect(duplicatedPage.path).toBe(newPagePath);
      expect(duplicatedPage.isEmpty).toBe(true);
      expect(duplicatedChild?.revision?.body).toBe(
        basePageChild?.revision?.body,
      );
      expect(duplicatedGrandchild?.revision?.body).toBe(
        basePageGrandhild?.revision?.body,
      );
      expect(duplicatedChild?.path).toBe(
        '/duplicatedv5EmptyPageForDuplicate7/v5_child_PageForDuplicate7',
      );
      expect(duplicatedGrandchild?.path).toBe(
        '/duplicatedv5EmptyPageForDuplicate7/v5_child_PageForDuplicate7/v5_grandchild_PageForDuplicate7',
      );
      expect(duplicatedGrandchild?.parent).toStrictEqual(duplicatedChild?._id);
      expect(duplicatedChild?.parent).toStrictEqual(duplicatedPage?._id);
    });
  });
  describe('Delete', () => {
    const deletePage = async (
      page,
      user,
      options,
      isRecursively,
      activityParameters?,
    ) => {
      const mockedDeleteRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'deleteRecursivelyMainOperation')
        .mockReturnValue(null);

      const deletedPage = await crowi.pageService.deletePage(
        page,
        user,
        options,
        isRecursively,
        activityParameters,
      );

      const argsForDeleteRecursivelyMainOperation =
        mockedDeleteRecursivelyMainOperation.mock.calls[0];

      mockedDeleteRecursivelyMainOperation.mockRestore();

      if (isRecursively) {
        await crowi.pageService.deleteRecursivelyMainOperation(
          ...(argsForDeleteRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.deleteRecursivelyMainOperation
          >),
        );
      }

      return deletedPage;
    };

    test('Should NOT delete root page', async () => {
      let isThrown = false;
      expect(rootPage).toBeTruthy();
      try {
        await deletePage(rootPage, dummyUser1, {}, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/delete',
        });
      } catch (err) {
        isThrown = true;
      }

      const page = await Page.findOne({ path: '/' });

      expect(isThrown).toBe(true);
      expect(page).toBeTruthy();
    });

    test('Should NOT delete trashed page', async () => {
      const trashedPage = await Page.findOne({
        path: '/trash/v5_PageForDelete1',
      });
      expect(trashedPage).toBeTruthy();

      let isThrown = false;
      try {
        await deletePage(trashedPage, dummyUser1, {}, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/delete',
        });
      } catch (err) {
        isThrown = true;
      }

      const page = await Page.findOne({ path: '/trash/v5_PageForDelete1' });

      expect(page).toBeTruthy();
      expect(isThrown).toBe(true);
    });

    test('Should NOT delete /user/hoge page', async () => {
      const dummyUser1Page = await Page.findOne({ path: '/user/v5DummyUser1' });
      expect(dummyUser1Page).toBeTruthy();
      let isThrown = false;
      try {
        await deletePage(dummyUser1Page, dummyUser1, {}, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/delete',
        });
      } catch (err) {
        isThrown = true;
      }

      const page = await Page.findOne({ path: '/user/v5DummyUser1' });

      expect(page).toBeTruthy();
      expect(isThrown).toBe(true);
    });

    test('Should delete single page', async () => {
      const pageToDelete = await Page.findOne({ path: '/v5_PageForDelete2' });
      expect(pageToDelete).toBeTruthy();
      const deletedPage = await deletePage(
        pageToDelete,
        dummyUser1,
        {},
        false,
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/delete',
        },
      );
      const page = await Page.findOne({ path: '/v5_PageForDelete2' });

      expect(page).toBeNull();
      expect(deletedPage.path).toBe(`/trash${pageToDelete?.path}`);
      expect(deletedPage.parent).toBeNull();
      expect(deletedPage.status).toBe(Page.STATUS_DELETED);
    });

    test('Should delete multiple pages including empty child', async () => {
      const parentPage = await Page.findOne({ path: '/v5_PageForDelete3' });
      const childPage = await Page.findOne({
        path: '/v5_PageForDelete3/v5_PageForDelete4',
      });
      const grandchildPage = await Page.findOne({
        path: '/v5_PageForDelete3/v5_PageForDelete4/v5_PageForDelete5',
      });
      expect(parentPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(grandchildPage).toBeTruthy();
      const deletedParentPage = await deletePage(
        parentPage,
        dummyUser1,
        {},
        true,
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/delete',
        },
      );
      const deletedChildPage = await Page.findOne({
        path: '/trash/v5_PageForDelete3/v5_PageForDelete4',
      });
      const deletedGrandchildPage = await Page.findOne({
        path: '/trash/v5_PageForDelete3/v5_PageForDelete4/v5_PageForDelete5',
      });

      // originally NOT empty page should exist with status 'deleted' and parent set null
      expect(deletedParentPage._id).toStrictEqual(parentPage?._id);
      expect(deletedParentPage.status).toBe(Page.STATUS_DELETED);
      expect(deletedParentPage.parent).toBeNull();
      // originally empty page should NOT exist
      expect(deletedChildPage).toBeNull();
      // originally NOT empty page should exist with status 'deleted' and parent set null
      expect(deletedGrandchildPage?._id).toStrictEqual(grandchildPage?._id);
      expect(deletedGrandchildPage?.status).toBe(Page.STATUS_DELETED);
      expect(deletedGrandchildPage?.parent).toBeNull();
    });

    test('Should delete page tag relation', async () => {
      const pageToDelete = await Page.findOne({ path: '/v5_PageForDelete6' });
      const tag1 = await Tag.findOne({ name: 'TagForDelete1' });
      const tag2 = await Tag.findOne({ name: 'TagForDelete2' });
      const pageRelation1 = await PageTagRelation.findOne({
        relatedTag: tag1?._id,
      });
      const pageRelation2 = await PageTagRelation.findOne({
        relatedTag: tag2?._id,
      });
      expect(pageToDelete).toBeTruthy();
      expect(tag1).toBeTruthy();
      expect(tag2).toBeTruthy();
      expect(pageRelation1).toBeTruthy();
      expect(pageRelation2).toBeTruthy();
      const deletedPage = await deletePage(
        pageToDelete,
        dummyUser1,
        {},
        false,
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/delete',
        },
      );
      const page = await Page.findOne({ path: '/v5_PageForDelete6' });
      const deletedTagRelation1 =
        await PageTagRelation.findOne<IPageTagRelation>({
          _id: pageRelation1?._id,
        });
      const deletedTagRelation2 =
        await PageTagRelation.findOne<IPageTagRelation>({
          _id: pageRelation2?._id,
        });

      expect(page).toBe(null);
      expect(deletedPage.status).toBe(Page.STATUS_DELETED);
      expect(deletedTagRelation1?.isPageTrashed).toBe(true);
      expect(deletedTagRelation2?.isPageTrashed).toBe(true);
    });
  });
  describe('Delete completely', () => {
    const deleteCompletely = async (
      page,
      user,
      options = {},
      isRecursively = false,
      preventEmitting = false,
      activityParameters?,
    ) => {
      const mockedDeleteCompletelyRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'deleteCompletelyRecursivelyMainOperation')
        .mockReturnValue(null);

      await crowi.pageService.deleteCompletely(
        page,
        user,
        options,
        isRecursively,
        preventEmitting,
        activityParameters,
      );

      const argsForDeleteCompletelyRecursivelyMainOperation =
        mockedDeleteCompletelyRecursivelyMainOperation.mock.calls[0];

      mockedDeleteCompletelyRecursivelyMainOperation.mockRestore();

      if (isRecursively) {
        await crowi.pageService.deleteCompletelyRecursivelyMainOperation(
          ...(argsForDeleteCompletelyRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.deleteCompletelyRecursivelyMainOperation
          >),
        );
      }

      return;
    };

    test('Should NOT completely delete root page', async () => {
      expect(rootPage).toBeTruthy();
      let isThrown = false;
      try {
        await deleteCompletely(rootPage, dummyUser1, {}, false, false, {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/deletecompletely',
        });
      } catch (err) {
        isThrown = true;
      }
      const page = await Page.findOne({ path: '/' });
      expect(page).toBeTruthy();
      expect(isThrown).toBe(true);
    });
    test('Should completely delete single page', async () => {
      const page = await Page.findOne({ path: '/v5_PageForDeleteCompletely1' });
      expect(page).toBeTruthy();

      await deleteCompletely(page, dummyUser1, {}, false, false, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/deletecompletely',
      });
      const deletedPage = await Page.findOne({
        _id: page?._id,
        path: '/v5_PageForDeleteCompletely1',
      });

      expect(deletedPage).toBeNull();
    });
    test('Should completely delete multiple pages', async () => {
      const parentPage = await Page.findOne({
        path: '/v5_PageForDeleteCompletely2',
      });
      const childPage = await Page.findOne({
        path: '/v5_PageForDeleteCompletely2/v5_PageForDeleteCompletely3',
      });
      const grandchildPage = await Page.findOne({
        path: '/v5_PageForDeleteCompletely2/v5_PageForDeleteCompletely3/v5_PageForDeleteCompletely4',
      });
      const tag1 = await Tag.findOne({ name: 'TagForDeleteCompletely1' });
      const tag2 = await Tag.findOne({ name: 'TagForDeleteCompletely2' });
      const pageTagRelation1 = await PageTagRelation.findOne({
        relatedPage: parentPage?._id,
      });
      const pageTagRelation2 = await PageTagRelation.findOne({
        relatedPage: grandchildPage?._id,
      });
      const bookmark = await Bookmark.findOne({ page: parentPage?._id });
      const comment = await Comment.findOne({ page: parentPage?._id });
      const pageRedirect1 = await PageRedirect.findOne({
        toPath: parentPage?.path,
      });
      const pageRedirect2 = await PageRedirect.findOne({
        toPath: grandchildPage?.path,
      });
      const shareLink1 = await ShareLink.findOne({
        relatedPage: parentPage?._id,
      });
      const shareLink2 = await ShareLink.findOne({
        relatedPage: grandchildPage?._id,
      });
      expect(parentPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(grandchildPage).toBeTruthy();
      expect(tag1).toBeTruthy();
      expect(tag2).toBeTruthy();
      expect(pageTagRelation1).toBeTruthy();
      expect(pageTagRelation2).toBeTruthy();
      expect(bookmark).toBeTruthy();
      expect(comment).toBeTruthy();
      expect(pageRedirect1).toBeTruthy();
      expect(pageRedirect2).toBeTruthy();
      expect(shareLink1).toBeTruthy();
      expect(shareLink2).toBeTruthy();

      await deleteCompletely(parentPage, dummyUser1, {}, true, false, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/deletecompletely',
      });
      const deletedPages = await Page.find({
        _id: { $in: [parentPage?._id, childPage?._id, grandchildPage?._id] },
      });
      const deletedRevisions = await Revision.find({
        pageId: { $in: [parentPage?._id, grandchildPage?._id] },
      });
      const tags = await Tag.find({ _id: { $in: [tag1?._id, tag2?._id] } });
      const deletedPageTagRelations = await PageTagRelation.find({
        _id: { $in: [pageTagRelation1?._id, pageTagRelation2?._id] },
      });
      const remainingBookmarks = await Bookmark.find({ _id: bookmark._id });
      const deletedComments = await Comment.find({ _id: comment?._id });
      const deletedPageRedirects = await PageRedirect.find({
        _id: { $in: [pageRedirect1?._id, pageRedirect2?._id] },
      });
      const deletedShareLinks = await ShareLink.find({
        _id: { $in: [shareLink1?._id, shareLink2?._id] },
      });

      // page should be null
      expect(deletedPages.length).toBe(0);
      // revision should be null
      expect(deletedRevisions.length).toBe(0);
      // tag should be Truthy
      expect(tags).toBeTruthy();
      // PageTagRelation should be null
      expect(deletedPageTagRelations.length).toBe(0);
      // bookmark should be null
      expect(remainingBookmarks.length).toBe(1);
      // comment should be null
      expect(deletedComments.length).toBe(0);
      // pageRedirect should be null
      expect(deletedPageRedirects.length).toBe(0);
      // sharelink should be null
      expect(deletedShareLinks.length).toBe(0);
    });
    test('Should completely delete trashed page', async () => {
      const page = await Page.findOne({
        path: '/trash/v5_PageForDeleteCompletely5',
      });
      const revision = await Revision.findOne({ pageId: page?._id });
      expect(page).toBeTruthy();
      expect(revision).toBeTruthy();
      await deleteCompletely(page, dummyUser1, {}, false, false, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/deletecompletely',
      });
      const deltedPage = await Page.findOne({ _id: page?._id });
      const deltedRevision = await Revision.findOne({ _id: revision?._id });

      expect(deltedPage).toBeNull();
      expect(deltedRevision).toBeNull();
    });
    test('Should completely deleting page in the middle results in having an empty page', async () => {
      const parentPage = await Page.findOne({
        path: '/v5_PageForDeleteCompletely6',
      });
      const childPage = await Page.findOne({
        path: '/v5_PageForDeleteCompletely6/v5_PageForDeleteCompletely7',
      });
      const grandchildPage = await Page.findOne({
        path: '/v5_PageForDeleteCompletely6/v5_PageForDeleteCompletely7/v5_PageForDeleteCompletely8',
      });
      expect(parentPage).toBeTruthy();
      expect(childPage).toBeTruthy();
      expect(grandchildPage).toBeTruthy();

      await deleteCompletely(childPage, dummyUser1, {}, false, false, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/deletecompletely',
      });
      const parentPageAfterDelete = await Page.findOne({
        path: '/v5_PageForDeleteCompletely6',
      });
      const childPageAfterDelete = await Page.findOne({
        path: '/v5_PageForDeleteCompletely6/v5_PageForDeleteCompletely7',
      });
      const grandchildPageAfterDelete = await Page.findOne({
        path: '/v5_PageForDeleteCompletely6/v5_PageForDeleteCompletely7/v5_PageForDeleteCompletely8',
      });
      const childOfDeletedPage = await Page.findOne({
        parent: childPageAfterDelete?._id,
      });

      expect(parentPageAfterDelete).toBeTruthy();
      expect(childPageAfterDelete).toBeTruthy();
      expect(grandchildPageAfterDelete).toBeTruthy();

      expect(childPageAfterDelete?._id).not.toStrictEqual(childPage?._id);
      expect(childPageAfterDelete?.isEmpty).toBe(true);
      expect(childPageAfterDelete?.parent).toStrictEqual(parentPage?._id);
      expect(childOfDeletedPage?._id).toStrictEqual(grandchildPage?._id);
    });
  });
  describe('revert', () => {
    const revertDeletedPage = async (
      page,
      user,
      options = {},
      isRecursively = false,
      activityParameters?,
    ) => {
      // mock return value
      const mockedRevertRecursivelyMainOperation = jest
        .spyOn(crowi.pageService, 'revertRecursivelyMainOperation')
        .mockReturnValue(null);
      const revertedPage = await crowi.pageService.revertDeletedPage(
        page,
        user,
        options,
        isRecursively,
        activityParameters,
      );

      const argsForRecursivelyMainOperation =
        mockedRevertRecursivelyMainOperation.mock.calls[0];

      // restores the original implementation
      mockedRevertRecursivelyMainOperation.mockRestore();
      if (isRecursively) {
        await crowi.pageService.revertRecursivelyMainOperation(
          ...(argsForRecursivelyMainOperation as Parameters<
            typeof crowi.pageService.revertRecursivelyMainOperation
          >),
        );
      }

      return revertedPage;
    };

    test('revert single deleted page', async () => {
      const deletedPage = await Page.findOne({
        path: '/trash/v5_revert1',
        status: Page.STATUS_DELETED,
      });
      const revision = await Revision.findOne({ pageId: deletedPage?._id });
      const tag = await Tag.findOne({ name: 'revertTag1' });
      const deletedPageTagRelation = await PageTagRelation.findOne({
        relatedPage: deletedPage?._id,
        relatedTag: tag?._id,
        isPageTrashed: true,
      });
      expect(deletedPage).toBeTruthy();
      expect(revision).toBeTruthy();
      expect(tag).toBeTruthy();
      expect(deletedPageTagRelation).toBeTruthy();

      const revertedPage = await revertDeletedPage(
        deletedPage,
        dummyUser1,
        {},
        false,
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/revert',
        },
      );
      const pageTagRelation = await PageTagRelation.findOne<IPageTagRelation>({
        relatedPage: deletedPage?._id,
        relatedTag: tag?._id,
      });

      expect(revertedPage.parent).toStrictEqual(rootPage._id);
      expect(revertedPage.path).toBe('/v5_revert1');
      expect(revertedPage.status).toBe(Page.STATUS_PUBLISHED);
      expect(pageTagRelation?.isPageTrashed).toBe(false);
    });

    test('revert multiple deleted page (has non existent page in the middle)', async () => {
      const deletedPage1 = await Page.findOne({
        path: '/trash/v5_revert2',
        status: Page.STATUS_DELETED,
      });
      const deletedPage2 = await Page.findOne({
        path: '/trash/v5_revert2/v5_revert3/v5_revert4',
        status: Page.STATUS_DELETED,
      });
      const revision1 = await Revision.findOne({ pageId: deletedPage1?._id });
      const revision2 = await Revision.findOne({ pageId: deletedPage2?._id });
      expect(deletedPage1).toBeTruthy();
      expect(deletedPage2).toBeTruthy();
      expect(revision1).toBeTruthy();
      expect(revision2).toBeTruthy();

      const revertedPage1 = await revertDeletedPage(
        deletedPage1,
        dummyUser1,
        {},
        true,
        {
          ip: '::ffff:127.0.0.1',
          endpoint: '/_api/v3/pages/revert',
        },
      );
      const revertedPage2 = await Page.findOne({ _id: deletedPage2?._id });
      const newlyCreatedPage = await Page.findOne({
        path: '/v5_revert2/v5_revert3',
      });

      expect(revertedPage1).toBeTruthy();
      expect(revertedPage2).toBeTruthy();
      expect(newlyCreatedPage).toBeTruthy();

      expect(revertedPage1.parent).toStrictEqual(rootPage._id);
      expect(revertedPage1.path).toBe('/v5_revert2');
      expect(revertedPage2?.path).toBe('/v5_revert2/v5_revert3/v5_revert4');
      expect(newlyCreatedPage?.parent).toStrictEqual(revertedPage1._id);
      expect(revertedPage2?.parent).toStrictEqual(newlyCreatedPage?._id);
      expect(revertedPage1.status).toBe(Page.STATUS_PUBLISHED);
      expect(revertedPage2?.status).toBe(Page.STATUS_PUBLISHED);
      expect(newlyCreatedPage?.status).toBe(Page.STATUS_PUBLISHED);
    });
  });
});
