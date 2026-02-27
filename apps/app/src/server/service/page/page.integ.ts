import assert from 'node:assert';
import { GroupType, type IRevision, type ITag, type IUser } from '@growi/core';
import mongoose, {
  type HydratedDocument,
  type Model,
  type Types,
} from 'mongoose';
import type { MockInstance } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type { CommentModel } from '~/features/comment/server';
import type { IBookmark } from '~/interfaces/bookmark-info';
import type { IComment } from '~/interfaces/comment';
import type { IShareLink } from '~/interfaces/share-link';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import PageTagRelation from '~/server/models/page-tag-relation';
import Tag from '~/server/models/tag';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { generalXssFilter } from '~/services/general-xss-filter';

import type { BookmarkModel } from '../../models/bookmark';
import type { ShareLinkModel } from '../../models/share-link';

let rootPage: PageDocument;
let dummyUser1: HydratedDocument<IUser>;
let testUser1: HydratedDocument<IUser>;
let testUser2: HydratedDocument<IUser>;
let testUser3: HydratedDocument<IUser>;
let parentTag: (ITag & { _id: Types.ObjectId }) | null;
let childTag: (ITag & { _id: Types.ObjectId }) | null;

let parentForRename1: PageDocument | null;
let parentForRename2: PageDocument | null;
let parentForRename3: PageDocument | null;
let parentForRename4: PageDocument | null;
let parentForRename5: PageDocument | null;
let parentForRename6: PageDocument | null;
let parentForRename7: PageDocument | null;
let parentForRename8: PageDocument | null;
let parentForRename9: PageDocument | null;

let irrelevantPage1: PageDocument | null;
let irrelevantPage2: PageDocument | null;

let childForRename1: PageDocument | null;
let childForRename2: PageDocument | null;
let childForRename3: PageDocument | null;

let parentForDuplicate: PageDocument | null;

let parentForDelete1: PageDocument | null;
let parentForDelete2: PageDocument | null;

let childForDelete: PageDocument | null;

let canDeleteCompletelyTestPage: PageDocument | null;
let parentForDeleteCompletely: PageDocument | null;

let parentForRevert1: PageDocument | null;
let parentForRevert2: PageDocument | null;

let childForDuplicate: PageDocument | null;
let childForDeleteCompletely: PageDocument | null;

let childForRevert: PageDocument | null;

describe('PageService', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let Revision: Model<IRevision>;
  let User: Model<IUser>;
  let Bookmark: BookmarkModel;
  let Comment: CommentModel;
  let ShareLink: ShareLinkModel;
  let generalXssFilterProcessSpy: MockInstance;

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', false);

    User = mongoose.model('User');
    Page = mongoose.model('Page') as PageModel;
    Revision = mongoose.model<IRevision>('Revision');
    Bookmark = mongoose.model<IBookmark, BookmarkModel>('Bookmark');
    Comment = mongoose.model<IComment, CommentModel>('Comment');
    ShareLink = mongoose.model<IShareLink, ShareLinkModel>('ShareLink');

    // Create test users if they don't exist
    const existingUser1 = await User.findOne({ username: 'someone1' });
    if (existingUser1 == null) {
      await User.insertMany([
        {
          name: 'someone1',
          username: 'someone1',
          email: 'someone1@example.com',
        },
        {
          name: 'someone2',
          username: 'someone2',
          email: 'someone2@example.com',
        },
        {
          name: 'someone3',
          username: 'someone3',
          email: 'someone3@example.com',
        },
      ]);
    }

    const foundTestUser1 = await User.findOne({ username: 'someone1' });
    const foundTestUser2 = await User.findOne({ username: 'someone2' });
    const foundTestUser3 = await User.findOne({ username: 'someone3' });
    assert(foundTestUser1 != null);
    assert(foundTestUser2 != null);
    assert(foundTestUser3 != null);
    testUser1 = foundTestUser1;
    testUser2 = foundTestUser2;
    testUser3 = foundTestUser3;

    // Create v5DummyUser1 if it doesn't exist
    const existingDummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
    if (existingDummyUser1 == null) {
      await User.insertMany([
        {
          name: 'v5DummyUser1',
          username: 'v5DummyUser1',
          email: 'v5dummyuser1@example.com',
        },
      ]);
    }
    const foundDummyUser1 = await User.findOne({ username: 'v5DummyUser1' });
    assert(foundDummyUser1 != null);
    dummyUser1 = foundDummyUser1;

    const existingUserGroup1 = await UserGroup.findOne({
      name: 'userGroupForCanDeleteCompletelyTest1',
    });
    if (existingUserGroup1 == null) {
      await UserGroup.insertMany([
        {
          name: 'userGroupForCanDeleteCompletelyTest1',
          parent: null,
        },
        {
          name: 'userGroupForCanDeleteCompletelyTest2',
          parent: null,
        },
      ]);
    }
    const userGroupForCanDeleteCompletelyTest1 = await UserGroup.findOne({
      name: 'userGroupForCanDeleteCompletelyTest1',
    });
    const userGroupForCanDeleteCompletelyTest2 = await UserGroup.findOne({
      name: 'userGroupForCanDeleteCompletelyTest2',
    });

    const existingRelation = await UserGroupRelation.findOne({
      relatedGroup: userGroupForCanDeleteCompletelyTest1?._id,
      relatedUser: testUser1._id,
    });
    if (
      existingRelation == null &&
      userGroupForCanDeleteCompletelyTest1 &&
      userGroupForCanDeleteCompletelyTest2
    ) {
      await UserGroupRelation.insertMany([
        {
          relatedGroup: userGroupForCanDeleteCompletelyTest1._id,
          relatedUser: testUser1._id,
        },
        {
          relatedGroup: userGroupForCanDeleteCompletelyTest2._id,
          relatedUser: testUser2._id,
        },
        {
          relatedGroup: userGroupForCanDeleteCompletelyTest1._id,
          relatedUser: testUser3._id,
        },
        {
          relatedGroup: userGroupForCanDeleteCompletelyTest2._id,
          relatedUser: testUser3._id,
        },
      ]);
    }

    // Ensure root page exists
    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      const rootPageId = new mongoose.Types.ObjectId();
      rootPage = await Page.create({
        _id: rootPageId,
        path: '/',
        grant: Page.GRANT_PUBLIC,
      });
    } else {
      rootPage = existingRootPage;
    }

    const existingParentForRename1 = await Page.findOne({
      path: '/parentForRename1',
    });
    if (existingParentForRename1 == null) {
      await Page.insertMany([
        {
          path: '/parentForRename1',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename2',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename3',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename4',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename5',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename6',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/level1/level2',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/level1/level2/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/level1/level2/level2',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename6-2021H1',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/level1-2021H1',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename1/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename2/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForRename3/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/canDeleteCompletelyTestPage',
          grant: Page.GRANT_USER_GROUP,
          creator: testUser2,
          grantedGroups: [
            {
              item: userGroupForCanDeleteCompletelyTest1?._id,
              type: GroupType.userGroup,
            },
            {
              item: userGroupForCanDeleteCompletelyTest2?._id,
              type: GroupType.userGroup,
            },
          ],
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForDuplicate',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
          revision: '600d395667536503354cbe91',
        },
        {
          path: '/parentForDuplicate/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
          revision: '600d395667536503354cbe92',
        },
        {
          path: '/parentForDelete1',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForDelete2',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForDelete/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForDeleteCompletely',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/parentForDeleteCompletely/child',
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/trash/parentForRevert1',
          status: Page.STATUS_DELETED,
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/trash/parentForRevert2',
          status: Page.STATUS_DELETED,
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
        {
          path: '/trash/parentForRevert/child',
          status: Page.STATUS_DELETED,
          grant: Page.GRANT_PUBLIC,
          creator: testUser1,
          lastUpdateUser: testUser1,
        },
      ]);
    }

    parentForRename1 = await Page.findOne({ path: '/parentForRename1' });
    parentForRename2 = await Page.findOne({ path: '/parentForRename2' });
    parentForRename3 = await Page.findOne({ path: '/parentForRename3' });
    parentForRename4 = await Page.findOne({ path: '/parentForRename4' });
    parentForRename5 = await Page.findOne({ path: '/parentForRename5' });
    parentForRename6 = await Page.findOne({ path: '/parentForRename6' });
    parentForRename7 = await Page.findOne({ path: '/level1/level2' });
    parentForRename8 = await Page.findOne({ path: '/level1/level2/child' });
    parentForRename9 = await Page.findOne({ path: '/level1/level2/level2' });

    irrelevantPage1 = await Page.findOne({ path: '/parentForRename6-2021H1' });
    irrelevantPage2 = await Page.findOne({ path: '/level1-2021H1' });

    parentForDuplicate = await Page.findOne({ path: '/parentForDuplicate' });

    parentForDelete1 = await Page.findOne({ path: '/parentForDelete1' });
    parentForDelete2 = await Page.findOne({ path: '/parentForDelete2' });

    canDeleteCompletelyTestPage = await Page.findOne({
      path: '/canDeleteCompletelyTestPage',
    });
    parentForDeleteCompletely = await Page.findOne({
      path: '/parentForDeleteCompletely',
    });
    parentForRevert1 = await Page.findOne({ path: '/trash/parentForRevert1' });
    parentForRevert2 = await Page.findOne({ path: '/trash/parentForRevert2' });

    childForRename1 = await Page.findOne({ path: '/parentForRename1/child' });
    childForRename2 = await Page.findOne({ path: '/parentForRename2/child' });
    childForRename3 = await Page.findOne({ path: '/parentForRename3/child' });

    childForDuplicate = await Page.findOne({
      path: '/parentForDuplicate/child',
    });
    childForDelete = await Page.findOne({ path: '/parentForDelete/child' });
    childForDeleteCompletely = await Page.findOne({
      path: '/parentForDeleteCompletely/child',
    });
    childForRevert = await Page.findOne({
      path: '/trash/parentForRevert/child',
    });

    const existingTag = await Tag.findOne({ name: 'Parent' });
    if (existingTag == null) {
      await Tag.insertMany([{ name: 'Parent' }, { name: 'Child' }]);
    }

    parentTag = await Tag.findOne({ name: 'Parent' });
    childTag = await Tag.findOne({ name: 'Child' });

    const existingPageTagRelation = await PageTagRelation.findOne({
      relatedPage: parentForDuplicate?._id,
    });
    if (
      existingPageTagRelation == null &&
      parentForDuplicate &&
      childForDuplicate
    ) {
      await PageTagRelation.insertMany([
        { relatedPage: parentForDuplicate, relatedTag: parentTag },
        { relatedPage: childForDuplicate, relatedTag: childTag },
      ]);
    }

    const existingRevision = await Revision.findOne({
      _id: '600d395667536503354cbe91',
    });
    if (existingRevision == null && parentForDuplicate && childForDuplicate) {
      await Revision.insertMany([
        {
          _id: '600d395667536503354cbe91',
          pageId: parentForDuplicate._id,
          body: 'duplicateBody',
        },
        {
          _id: '600d395667536503354cbe92',
          pageId: childForDuplicate._id,
          body: 'duplicateChildBody',
        },
      ]);
    }

    generalXssFilterProcessSpy = vi.spyOn(generalXssFilter, 'process');

    /**
     * getParentAndFillAncestors
     */
    const pageIdPAF1 = new mongoose.Types.ObjectId();
    const pageIdPAF2 = new mongoose.Types.ObjectId();
    const pageIdPAF3 = new mongoose.Types.ObjectId();

    const existingPAF1 = await Page.findOne({ path: '/PAF1' });
    if (existingPAF1 == null) {
      await Page.insertMany([
        {
          _id: pageIdPAF1,
          path: '/PAF1',
          grant: Page.GRANT_PUBLIC,
          creator: dummyUser1,
          lastUpdateUser: dummyUser1._id,
          isEmpty: false,
          parent: rootPage._id,
          descendantCount: 0,
        },
        {
          _id: pageIdPAF2,
          path: '/emp_anc3',
          grant: Page.GRANT_PUBLIC,
          isEmpty: true,
          descendantCount: 1,
          parent: rootPage._id,
        },
        {
          path: '/emp_anc3/PAF3',
          grant: Page.GRANT_PUBLIC,
          creator: dummyUser1,
          lastUpdateUser: dummyUser1._id,
          isEmpty: false,
          descendantCount: 0,
          parent: pageIdPAF2,
        },
        {
          _id: pageIdPAF3,
          path: '/emp_anc4',
          grant: Page.GRANT_PUBLIC,
          isEmpty: true,
          descendantCount: 1,
          parent: rootPage._id,
        },
        {
          path: '/emp_anc4/PAF4',
          grant: Page.GRANT_PUBLIC,
          creator: dummyUser1,
          lastUpdateUser: dummyUser1._id,
          isEmpty: false,
          descendantCount: 0,
          parent: pageIdPAF3,
        },
        {
          path: '/emp_anc4',
          grant: Page.GRANT_OWNER,
          grantedUsers: [dummyUser1._id],
          creator: dummyUser1,
          lastUpdateUser: dummyUser1._id,
          isEmpty: false,
        },
        {
          path: '/get_parent_A',
          creator: dummyUser1,
          lastUpdateUser: dummyUser1,
          parent: null,
        },
        {
          path: '/get_parent_A/get_parent_B',
          creator: dummyUser1,
          lastUpdateUser: dummyUser1,
          parent: null,
        },
        {
          path: '/get_parent_C',
          creator: dummyUser1,
          lastUpdateUser: dummyUser1,
          parent: rootPage._id,
        },
        {
          path: '/get_parent_C/get_parent_D',
          creator: dummyUser1,
          lastUpdateUser: dummyUser1,
          parent: null,
        },
      ]);
    }
  });

  describe('rename page without using renameDescendantsWithStreamSpy', () => {
    it('rename page with different tree with isRecursively [deeper]', async () => {
      assert(parentForRename6 != null);
      const resultPage = await crowi.pageService.renamePage(
        parentForRename6,
        '/parentForRename6/renamedChild',
        testUser1,
        { isRecursively: true },
        { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
      );
      const wrongPage = await Page.findOne({
        path: '/parentForRename6/renamedChild/renamedChild',
      });
      const expectPage1 = await Page.findOne({
        path: '/parentForRename6/renamedChild',
      });
      const expectPage2 = await Page.findOne({
        path: '/parentForRename6-2021H1',
      });

      assert(resultPage != null);
      expect(resultPage.path).toEqual(expectPage1?.path);
      expect(expectPage2?.path).not.toBeNull();

      // Check that pages that are not to be renamed have not been renamed
      expect(wrongPage).toBeNull();
    });

    it('rename page with different tree with isRecursively [shallower]', async () => {
      assert(parentForRename7 != null);
      // setup
      expect(await Page.findOne({ path: '/level1' })).toBeNull();
      expect(await Page.findOne({ path: '/level1/level2' })).not.toBeNull();
      expect(
        await Page.findOne({ path: '/level1/level2/child' }),
      ).not.toBeNull();
      expect(
        await Page.findOne({ path: '/level1/level2/level2' }),
      ).not.toBeNull();
      expect(await Page.findOne({ path: '/level1-2021H1' })).not.toBeNull();

      // when
      //   rename /level1/level2 --> /level1
      await crowi.pageService.renamePage(
        parentForRename7,
        '/level1',
        testUser1,
        { isRecursively: true },
        { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
      );

      // then
      expect(await Page.findOne({ path: '/level1' })).not.toBeNull();
      expect(await Page.findOne({ path: '/level1/child' })).not.toBeNull();
      expect(await Page.findOne({ path: '/level1/level2' })).not.toBeNull();
      expect(await Page.findOne({ path: '/level1/level2/child' })).toBeNull();
      expect(await Page.findOne({ path: '/level1/level2/level2' })).toBeNull();

      // Check that pages that are not to be renamed have not been renamed
      expect(await Page.findOne({ path: '/level1-2021H1' })).not.toBeNull();
    });
  });

  describe('rename page', () => {
    let pageEventSpy: MockInstance;
    let renameDescendantsWithStreamSpy: MockInstance;
    const dateToUse = new Date(2000, 1, 1, 0, 0, 0);

    beforeEach(async () => {
      // mock new Date() and Date.now()
      vi.useFakeTimers();
      vi.setSystemTime(dateToUse);

      pageEventSpy = vi
        .spyOn(crowi.pageService.pageEvent, 'emit')
        .mockImplementation(() => true);
      renameDescendantsWithStreamSpy = vi
        .spyOn(crowi.pageService as any, 'renameDescendantsWithStream')
        .mockImplementation(() => Promise.resolve());
    });

    describe('renamePage()', () => {
      it('rename page without options', async () => {
        assert(parentForRename1 != null);
        const resultPage = await crowi.pageService.renamePage(
          parentForRename1,
          '/renamed1',
          testUser2,
          {},
          { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
        );

        expect(generalXssFilterProcessSpy).toHaveBeenCalled();

        expect(pageEventSpy).toHaveBeenCalledWith('rename');

        assert(resultPage != null);
        expect(resultPage.path).toBe('/renamed1');
        expect(resultPage.updatedAt).toEqual(parentForRename1.updatedAt);
        expect(resultPage.lastUpdateUser).toEqual(testUser1._id);
      });

      it('rename page with updateMetadata option', async () => {
        assert(parentForRename2 != null);
        const resultPage = await crowi.pageService.renamePage(
          parentForRename2,
          '/renamed2',
          testUser2,
          { updateMetadata: true },
          { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
        );

        expect(generalXssFilterProcessSpy).toHaveBeenCalled();

        expect(pageEventSpy).toHaveBeenCalledWith('rename');

        assert(resultPage != null);
        expect(resultPage.path).toBe('/renamed2');
        expect(resultPage.updatedAt).toEqual(dateToUse);
        expect(resultPage.lastUpdateUser).toEqual(testUser2._id);
      });

      it('rename page with createRedirectPage option', async () => {
        assert(parentForRename3 != null);
        const resultPage = await crowi.pageService.renamePage(
          parentForRename3,
          '/renamed3',
          testUser2,
          { createRedirectPage: true },
          { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
        );

        expect(generalXssFilterProcessSpy).toHaveBeenCalled();
        expect(pageEventSpy).toHaveBeenCalledWith('rename');

        assert(resultPage != null);
        expect(resultPage.path).toBe('/renamed3');
        expect(resultPage.updatedAt).toEqual(parentForRename3.updatedAt);
        expect(resultPage.lastUpdateUser).toEqual(testUser1._id);
      });

      it('rename page with isRecursively', async () => {
        assert(parentForRename4 != null);
        const resultPage = await crowi.pageService.renamePage(
          parentForRename4,
          '/renamed4',
          testUser2,
          { isRecursively: true },
          { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
        );

        expect(generalXssFilterProcessSpy).toHaveBeenCalled();
        expect(renameDescendantsWithStreamSpy).toHaveBeenCalled();
        expect(pageEventSpy).toHaveBeenCalledWith('rename');

        assert(resultPage != null);
        expect(resultPage.path).toBe('/renamed4');
        expect(resultPage.updatedAt).toEqual(parentForRename4.updatedAt);
        expect(resultPage.lastUpdateUser).toEqual(testUser1._id);
      });

      it('rename page with different tree with isRecursively', async () => {
        assert(parentForRename5 != null);
        const resultPage = await crowi.pageService.renamePage(
          parentForRename5,
          '/parentForRename5/renamedChild',
          testUser1,
          { isRecursively: true },
          { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
        );
        const wrongPage = await Page.findOne({
          path: '/parentForRename5/renamedChild/renamedChild',
        });
        const expectPage = await Page.findOne({
          path: '/parentForRename5/renamedChild',
        });

        assert(resultPage != null);
        expect(resultPage.path).toEqual(expectPage?.path);
        expect(wrongPage).toBeNull();
      });
    });

    it('renameDescendants without options', async () => {
      assert(childForRename1 != null);
      const oldPagePathPrefix = /^\/parentForRename1/i;
      const newPagePathPrefix = '/renamed1';

      await (crowi.pageService as any).renameDescendants(
        [childForRename1],
        testUser2,
        {},
        oldPagePathPrefix,
        newPagePathPrefix,
      );
      const resultPage = await Page.findOne({ path: '/renamed1/child' });

      expect(resultPage).not.toBeNull();
      expect(pageEventSpy).toHaveBeenCalledWith(
        'updateMany',
        [childForRename1],
        testUser2,
      );

      expect(resultPage?.path).toBe('/renamed1/child');
      expect(resultPage?.updatedAt).toEqual(childForRename1.updatedAt);
      expect(resultPage?.lastUpdateUser).toEqual(testUser1._id);
    });

    it('renameDescendants with updateMetadata option', async () => {
      assert(childForRename2 != null);
      const oldPagePathPrefix = /^\/parentForRename2/i;
      const newPagePathPrefix = '/renamed2';

      await (crowi.pageService as any).renameDescendants(
        [childForRename2],
        testUser2,
        { updateMetadata: true },
        oldPagePathPrefix,
        newPagePathPrefix,
      );
      const resultPage = await Page.findOne({ path: '/renamed2/child' });

      expect(resultPage).not.toBeNull();
      expect(pageEventSpy).toHaveBeenCalledWith(
        'updateMany',
        [childForRename2],
        testUser2,
      );

      expect(resultPage?.path).toBe('/renamed2/child');
      expect(resultPage?.updatedAt).toEqual(dateToUse);
      expect(resultPage?.lastUpdateUser).toEqual(testUser2._id);
    });

    it('renameDescendants with createRedirectPage option', async () => {
      assert(childForRename3 != null);
      const oldPagePathPrefix = /^\/parentForRename3/i;
      const newPagePathPrefix = '/renamed3';

      await (crowi.pageService as any).renameDescendants(
        [childForRename3],
        testUser2,
        { createRedirectPage: true },
        oldPagePathPrefix,
        newPagePathPrefix,
      );
      const resultPage = await Page.findOne({ path: '/renamed3/child' });

      expect(resultPage).not.toBeNull();
      expect(pageEventSpy).toHaveBeenCalledWith(
        'updateMany',
        [childForRename3],
        testUser2,
      );

      expect(resultPage?.path).toBe('/renamed3/child');
      expect(resultPage?.updatedAt).toEqual(childForRename3.updatedAt);
      expect(resultPage?.lastUpdateUser).toEqual(testUser1._id);
    });
  });

  describe('getParentAndFillAncestors', () => {
    it('return parent if exist', async () => {
      const page1 = await Page.findOne({ path: '/PAF1' });
      assert(page1 != null);
      const parent = await crowi.pageService.getParentAndFillAncestorsByUser(
        dummyUser1,
        page1.path,
      );
      expect(parent).toBeTruthy();
      expect(page1.parent).toStrictEqual(parent._id);
    });

    it('create parent and ancestors when they do not exist, and return the new parent', async () => {
      const path1 = '/emp_anc1';
      const path2 = '/emp_anc1/emp_anc2';
      const path3 = '/emp_anc1/emp_anc2/PAF2';
      const _page1 = await Page.findOne({ path: path1 }); // not exist
      const _page2 = await Page.findOne({ path: path2 }); // not exist
      const _page3 = await Page.findOne({ path: path3 }); // not exist
      expect(_page1).toBeNull();
      expect(_page2).toBeNull();
      expect(_page3).toBeNull();

      const parent = await crowi.pageService.getParentAndFillAncestorsByUser(
        dummyUser1,
        path3,
      );
      const page1 = await Page.findOne({ path: path1 });
      const page2 = await Page.findOne({ path: path2 });
      const page3 = await Page.findOne({ path: path3 });

      expect(parent._id).toStrictEqual(page2?._id);
      expect(parent.path).toStrictEqual(page2?.path);
      expect(parent.parent).toStrictEqual(page2?.parent);

      expect(parent).toBeTruthy();
      expect(page1).toBeTruthy();
      expect(page2).toBeTruthy();
      expect(page3).toBeNull();

      expect(page1?.parent).toStrictEqual(rootPage._id);
      expect(page2?.parent).toStrictEqual(page1?._id);
    });

    it('return parent even if the parent page is empty', async () => {
      const path1 = '/emp_anc3';
      const path2 = '/emp_anc3/PAF3';
      const _page1 = await Page.findOne({ path: path1, isEmpty: true });
      const _page2 = await Page.findOne({ path: path2, isEmpty: false });
      expect(_page1).toBeTruthy();
      expect(_page2).toBeTruthy();
      assert(_page2 != null);

      const parent = await crowi.pageService.getParentAndFillAncestorsByUser(
        dummyUser1,
        _page2.path,
      );
      const page1 = await Page.findOne({ path: path1, isEmpty: true }); // parent
      const page2 = await Page.findOne({ path: path2, isEmpty: false });

      // check for the parent (should be the same as page1)
      expect(parent._id).toStrictEqual(page1?._id);
      expect(parent.path).toStrictEqual(page1?.path);
      expect(parent.parent).toStrictEqual(page1?.parent);

      expect(page1?.parent).toStrictEqual(rootPage._id);
      expect(page2?.parent).toStrictEqual(page1?._id);
    });
  });
});
