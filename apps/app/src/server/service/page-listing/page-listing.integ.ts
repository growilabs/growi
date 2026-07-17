import type { IPage, IUser } from '@growi/core/dist/interfaces';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';

import { PageActionStage, PageActionType } from '~/interfaces/page-operation';
import type { PageModel } from '~/server/models/page';
import type { IPageOperation } from '~/server/models/page-operation';

import { pageListingService } from './page-listing';

// Mock the page-operation service
vi.mock('~/server/service/page-operation', () => ({
  pageOperationService: {
    generateProcessInfo: vi.fn((pageOperations: IPageOperation[]) => {
      const processInfo: Record<string, any> = {};
      pageOperations.forEach((pageOp) => {
        const pageId = pageOp.page._id.toString();
        processInfo[pageId] = {
          [pageOp.actionType]: {
            [PageActionStage.Main]: { isProcessable: true },
            [PageActionStage.Sub]: undefined,
          },
        };
      });
      return processInfo;
    }),
  },
}));

describe('page-listing store integration tests', () => {
  let Page: PageModel;
  let User: Model<IUser>;
  let PageOperation: Model<IPageOperation>;
  let testUser: HydratedDocument<IUser>;
  let rootPage: HydratedDocument<IPage>;

  // Helper function to validate IPageForTreeItem type structure
  const validatePageForTreeItem = (page: any): void => {
    expect(page).toBeDefined();
    expect(page._id).toBeDefined();
    expect(typeof page.path).toBe('string');
    expect(page.grant).toBeDefined();
    expect(typeof page.isEmpty).toBe('boolean');
    expect(typeof page.descendantCount).toBe('number');
    // revision is required when isEmpty is false
    if (page.isEmpty === false) {
      expect(page.revision).toBeDefined();
      expect(isValidObjectId(page.revision)).toBe(true);
    }
    // processData is optional
    if (page.processData !== undefined) {
      expect(page.processData).toBeInstanceOf(Object);
    }
  };

  beforeAll(async () => {
    // setup models
    const setupPage = (await import('~/server/models/page')).default;
    setupPage(null);
    const setupUser = (await import('~/server/models/user')).default;
    setupUser(null);

    // get models
    Page = mongoose.model<IPage, PageModel>('Page');
    User = mongoose.model<IUser>('User');
    PageOperation = (await import('~/server/models/page-operation')).default;
  });

  beforeEach(async () => {
    // Clean up database
    await Page.deleteMany({});
    await User.deleteMany({});
    await PageOperation.deleteMany({});

    // Create test user
    testUser = await User.create({
      name: 'Test User',
      username: 'testuser',
      email: 'test@example.com',
      lang: 'en_US',
    });

    // Create root page
    rootPage = await Page.create({
      path: '/',
      revision: new mongoose.Types.ObjectId(),
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      grant: 1, // GRANT_PUBLIC
      isEmpty: false,
      descendantCount: 0,
    });
  });

  describe('pageListingService.findRootByViewer', () => {
    test('should return root page successfully', async () => {
      const rootPageResult =
        await pageListingService.findRootByViewer(testUser);

      expect(rootPageResult).toBeDefined();
      expect(rootPageResult.path).toBe('/');
      expect(rootPageResult._id.toString()).toBe(rootPage._id.toString());
      expect(rootPageResult.grant).toBe(1);
      expect(rootPageResult.isEmpty).toBe(false);
      expect(rootPageResult.descendantCount).toBe(0);
    });

    test('should handle error when root page does not exist', async () => {
      // Remove the root page
      await Page.deleteOne({ path: '/' });

      try {
        await pageListingService.findRootByViewer(testUser);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should return proper page structure that matches IPageForTreeItem type', async () => {
      const rootPageResult =
        await pageListingService.findRootByViewer(testUser);

      // Use helper function to validate type structure
      validatePageForTreeItem(rootPageResult);

      // Additional type-specific validations
      expect(typeof rootPageResult._id).toBe('object'); // ObjectId
      expect(rootPageResult.path).toBe('/');
      expect([null, 1, 2, 3, 4, 5]).toContain(rootPageResult.grant); // Valid grant values
    });

    test('should work without user (guest access) and return type-safe result', async () => {
      const rootPageResult = await pageListingService.findRootByViewer();

      validatePageForTreeItem(rootPageResult);
      expect(rootPageResult.path).toBe('/');
      expect(rootPageResult._id.toString()).toBe(rootPage._id.toString());
    });
  });

  describe('pageListingService.findChildrenByParentPathOrIdAndViewer', () => {
    let childPage1: HydratedDocument<IPage>;

    beforeEach(async () => {
      // Create child pages
      childPage1 = await Page.create({
        path: '/child1',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 1,
        parent: rootPage._id,
      });

      await Page.create({
        path: '/child2',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: rootPage._id,
      });

      // Create grandchild page
      await Page.create({
        path: '/child1/grandchild',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: childPage1._id,
      });

      // Update root page descendant count
      await Page.updateOne({ _id: rootPage._id }, { descendantCount: 2 });
    });

    test('should find children by parent path and return type-safe results', async () => {
      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/',
          testUser,
        );

      expect(children).toHaveLength(2);
      children.forEach((child) => {
        validatePageForTreeItem(child);
        expect(['/child1', '/child2']).toContain(child.path);
      });
    });

    test('should find children by parent ID and return type-safe results', async () => {
      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          rootPage._id.toString(),
          testUser,
        );

      expect(children).toHaveLength(2);
      children.forEach((child) => {
        validatePageForTreeItem(child);
      });
    });

    test('should handle nested children correctly', async () => {
      const nestedChildren =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/child1',
          testUser,
        );

      expect(nestedChildren).toHaveLength(1);
      const grandChild = nestedChildren[0];
      validatePageForTreeItem(grandChild);
      expect(grandChild.path).toBe('/child1/grandchild');
    });

    test('should return empty array when no children exist', async () => {
      const noChildren =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/child2',
          testUser,
        );

      expect(noChildren).toHaveLength(0);
      expect(Array.isArray(noChildren)).toBe(true);
    });

    test('should work without user (guest access)', async () => {
      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer('/');

      expect(children).toHaveLength(2);
      children.forEach((child) => {
        validatePageForTreeItem(child);
      });
    });

    test('should sort children by path in ascending order', async () => {
      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/',
          testUser,
        );

      expect(children).toHaveLength(2);
      expect(children[0].path).toBe('/child1');
      expect(children[1].path).toBe('/child2');
    });
  });

  describe('pageListingService processData injection', () => {
    let operatingPage: HydratedDocument<IPage>;

    beforeEach(async () => {
      // Create a page that will have operations
      operatingPage = await Page.create({
        path: '/operating-page',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: rootPage._id,
      });

      // Create a PageOperation for this page
      await PageOperation.create({
        actionType: PageActionType.Rename,
        actionStage: PageActionStage.Main,
        page: {
          _id: operatingPage._id,
          path: operatingPage.path,
          isEmpty: operatingPage.isEmpty,
          grant: operatingPage.grant,
          grantedGroups: [],
          descendantCount: operatingPage.descendantCount,
        },
        user: {
          _id: testUser._id,
        },
        fromPath: '/operating-page',
        toPath: '/renamed-operating-page',
        options: {},
      });
    });

    test('should inject processData for pages with operations', async () => {
      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/',
          testUser,
        );

      // Find the operating page in results
      const operatingResult = children.find(
        (child) => child.path === '/operating-page',
      );
      expect(operatingResult).toBeDefined();

      // Validate type structure
      if (operatingResult) {
        validatePageForTreeItem(operatingResult);

        // Check that processData was injected
        expect(operatingResult.processData).toBeDefined();
        expect(operatingResult.processData).toBeInstanceOf(Object);
      }
    });

    test('should set processData to undefined for pages without operations', async () => {
      // Create another page without operations
      await Page.create({
        path: '/normal-page',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: rootPage._id,
      });

      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/',
          testUser,
        );
      const normalPage = children.find(
        (child) => child.path === '/normal-page',
      );

      expect(normalPage).toBeDefined();
      if (normalPage) {
        validatePageForTreeItem(normalPage);
        expect(normalPage.processData).toBeUndefined();
      }
    });

    test('should maintain type safety with mixed processData scenarios', async () => {
      // Create pages with and without operations
      await Page.create({
        path: '/mixed-test-1',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: rootPage._id,
      });

      await Page.create({
        path: '/mixed-test-2',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: rootPage._id,
      });

      const children =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/',
          testUser,
        );

      // All results should be type-safe regardless of processData presence
      children.forEach((child) => {
        validatePageForTreeItem(child);

        // processData should be either undefined or a valid object
        if (child.processData !== undefined) {
          expect(child.processData).toBeInstanceOf(Object);
        }
      });
    });
  });

  describe('PageQueryBuilder exec() type safety tests', () => {
    test('findRootByViewer should return object with correct _id type', async () => {
      const result = await pageListingService.findRootByViewer(testUser);

      // PageQueryBuilder.exec() returns any, but we expect ObjectId-like behavior
      expect(result._id).toBeDefined();
      expect(result._id.toString).toBeDefined();
      expect(typeof result._id.toString()).toBe('string');
      expect(result._id.toString().length).toBe(24); // MongoDB ObjectId string length
    });

    test('findChildrenByParentPathOrIdAndViewer should return array with correct _id types', async () => {
      // Create test child page first
      await Page.create({
        path: '/test-child',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: 1, // GRANT_PUBLIC
        isEmpty: false,
        descendantCount: 0,
        parent: rootPage._id,
      });

      const results =
        await pageListingService.findChildrenByParentPathOrIdAndViewer(
          '/',
          testUser,
        );

      expect(Array.isArray(results)).toBe(true);
      results.forEach((result) => {
        // Validate _id behavior from exec() any return type
        expect(result._id).toBeDefined();
        expect(result._id.toString).toBeDefined();
        expect(typeof result._id.toString()).toBe('string');
        expect(result._id.toString().length).toBe(24);
      });
    });
  });

  describe('viewer-aware limited children for markdown footer', () => {
    const GRANT_PUBLIC = 1;
    const GRANT_OWNER = 4;

    let parentPage: HydratedDocument<IPage>;
    let otherUser: HydratedDocument<IUser>;

    // 5 public children (visible to everyone), lexicographically first
    const publicChildPaths = [
      '/parent/aaa-01',
      '/parent/aaa-02',
      '/parent/aaa-03',
      '/parent/aaa-04',
      '/parent/aaa-05',
    ];
    // empty container page (public) — footer navigation must not stop at containers
    const containerChildPath = '/parent/container';
    // owner-restricted page visible to testUser only (invisible to guest)
    const ownedByTestUserPath = '/parent/mmm-own-testuser';
    // owner-restricted pages owned by another user — invisible to testUser AND guest
    const ownedByOtherUserPaths = [
      '/parent/zzz-secret-01',
      '/parent/zzz-secret-02',
    ];

    // Visible direct-child totals derived from the seed above:
    //   testUser: 5 public + 1 container + 1 owned-by-testUser = 7
    //   guest:    5 public + 1 container                       = 6
    //   invisible to both: 2 owned-by-otherUser
    //   total docs under /parent: 9
    const VISIBLE_TO_TESTUSER = 7;
    const VISIBLE_TO_GUEST = 6;

    beforeEach(async () => {
      otherUser = await User.create({
        name: 'Other User',
        username: 'otheruser',
        email: 'other@example.com',
        lang: 'en_US',
      });

      parentPage = await Page.create({
        path: '/parent',
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: GRANT_PUBLIC,
        isEmpty: false,
        descendantCount: 9,
        parent: rootPage._id,
      });

      await Page.insertMany(
        publicChildPaths.map((path) => ({
          path,
          revision: new mongoose.Types.ObjectId(),
          creator: testUser._id,
          lastUpdateUser: testUser._id,
          grant: GRANT_PUBLIC,
          isEmpty: false,
          descendantCount: 0,
          parent: parentPage._id,
        })),
      );

      // empty container child: no revision, isEmpty true
      await Page.create({
        path: containerChildPath,
        creator: testUser._id,
        grant: GRANT_PUBLIC,
        isEmpty: true,
        descendantCount: 1,
        parent: parentPage._id,
      });

      await Page.create({
        path: ownedByTestUserPath,
        revision: new mongoose.Types.ObjectId(),
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        grant: GRANT_OWNER,
        grantedUsers: [testUser._id],
        isEmpty: false,
        descendantCount: 0,
        parent: parentPage._id,
      });

      await Page.insertMany(
        ownedByOtherUserPaths.map((path) => ({
          path,
          revision: new mongoose.Types.ObjectId(),
          creator: otherUser._id,
          lastUpdateUser: otherUser._id,
          grant: GRANT_OWNER,
          grantedUsers: [otherUser._id],
          isEmpty: false,
          descendantCount: 0,
          parent: parentPage._id,
        })),
      );
    });

    describe('findLimitedChildrenByParentIdAndViewer', () => {
      test('should return at most `limit` viewer-visible direct children (invisible ones excluded)', async () => {
        const limit = 3;
        const children =
          await pageListingService.findLimitedChildrenByParentIdAndViewer(
            parentPage._id.toString(),
            testUser,
            limit,
          );

        // limited to `limit` even though 7 are visible
        expect(children).toHaveLength(limit);

        const paths = children.map((c) => c.path);
        // none of the invisible (owner-restricted to otherUser) pages leak
        ownedByOtherUserPaths.forEach((secret) => {
          expect(paths).not.toContain(secret);
        });
        // deterministic ascending-path order → the lexicographically-first 3
        expect(paths).toEqual([
          '/parent/aaa-01',
          '/parent/aaa-02',
          '/parent/aaa-03',
        ]);
      });

      test('should include empty container children and stay consistent with the count', async () => {
        // fetch with a generous limit to retrieve every visible child
        const children =
          await pageListingService.findLimitedChildrenByParentIdAndViewer(
            parentPage._id.toString(),
            testUser,
            100,
          );
        const count = await pageListingService.countChildrenByParentIdAndViewer(
          parentPage._id.toString(),
          testUser,
        );

        expect(children).toHaveLength(VISIBLE_TO_TESTUSER);
        expect(children).toHaveLength(count);

        const paths = children.map((c) => c.path);
        // the empty container is a direct child and must be present
        expect(paths).toContain(containerChildPath);

        children.forEach((child) => {
          validatePageForTreeItem(child);
        });
      });

      test('guest (no user) sees only publicly visible children', async () => {
        const guestChildren =
          await pageListingService.findLimitedChildrenByParentIdAndViewer(
            parentPage._id.toString(),
            undefined,
            100,
          );

        const guestPaths = guestChildren.map((c) => c.path);
        expect(guestChildren).toHaveLength(VISIBLE_TO_GUEST);
        // owner-restricted pages (incl. the one owned by testUser) are hidden from guests
        expect(guestPaths).not.toContain(ownedByTestUserPath);
        ownedByOtherUserPaths.forEach((secret) => {
          expect(guestPaths).not.toContain(secret);
        });
        // the public container is still visible to guests
        expect(guestPaths).toContain(containerChildPath);
      });
    });

    describe('countChildrenByParentIdAndViewer', () => {
      test('should return the exact number of viewer-visible direct children, excluding invisible pages and ignoring the link limit', async () => {
        const count = await pageListingService.countChildrenByParentIdAndViewer(
          parentPage._id.toString(),
          testUser,
        );

        // 7 = 9 total direct children minus the 2 restricted to otherUser.
        // It is NOT capped by any link limit and NOT the full 9.
        expect(count).toBe(VISIBLE_TO_TESTUSER);
      });

      test('should be viewer-aware: a guest counts fewer children than a member', async () => {
        const memberCount =
          await pageListingService.countChildrenByParentIdAndViewer(
            parentPage._id.toString(),
            testUser,
          );
        const guestCount =
          await pageListingService.countChildrenByParentIdAndViewer(
            parentPage._id.toString(),
          );

        expect(memberCount).toBe(VISIBLE_TO_TESTUSER);
        expect(guestCount).toBe(VISIBLE_TO_GUEST);
        expect(guestCount).toBeLessThan(memberCount);
      });
    });
  });
});
