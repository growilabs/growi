import type { IPage, IUser } from '@growi/core/dist/interfaces';
import mongoose from 'mongoose';
import type { HydratedDocument, Model } from 'mongoose';

import { PageActionType, PageActionStage } from '~/interfaces/page-operation';
import type { PageModel } from '~/server/models/page';
import type { IPageOperation } from '~/server/models/page-operation';

import { pageListingService } from './page-listing';

// Mock the page-operation service
vi.mock('~/server/service/page-operation', () => ({
  pageOperationService: {
    generateProcessInfo: vi.fn((pageOperations: IPageOperation[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validatePageForTreeItem = (page: any): void => {
    expect(page).toBeDefined();
    expect(page._id).toBeDefined();
    expect(typeof page.path).toBe('string');
    expect(page.grant).toBeDefined();
    expect(typeof page.isEmpty).toBe('boolean');
    expect(typeof page.descendantCount).toBe('number');
    expect(page.createdAt).toBeDefined();
    expect(page.updatedAt).toBeDefined();
    // processData is optional
    if (page.processData !== undefined) {
      expect(page.processData).toBeInstanceOf(Object);
    }
  };

  beforeAll(async() => {
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

  beforeEach(async() => {
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
    test('should return root page successfully', async() => {
      const rootPageResult = await pageListingService.findRootByViewer(testUser);

      expect(rootPageResult).toBeDefined();
      expect(rootPageResult.path).toBe('/');
      expect(rootPageResult._id.toString()).toBe(rootPage._id.toString());
      expect(rootPageResult.grant).toBe(1);
      expect(rootPageResult.isEmpty).toBe(false);
      expect(rootPageResult.descendantCount).toBe(0);
    });

    test('should handle error when root page does not exist', async() => {
      // Remove the root page
      await Page.deleteOne({ path: '/' });

      try {
        await pageListingService.findRootByViewer(testUser);
        // Should not reach here
        expect(true).toBe(false);
      }
      catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should return proper page structure that matches IPageForTreeItem type', async() => {
      const rootPageResult = await pageListingService.findRootByViewer(testUser);

      // Use helper function to validate type structure
      validatePageForTreeItem(rootPageResult);

      // Additional type-specific validations
      expect(typeof rootPageResult._id).toBe('object'); // ObjectId
      expect(rootPageResult.path).toBe('/');
      expect([null, 1, 2, 3, 4, 5]).toContain(rootPageResult.grant); // Valid grant values
      expect(rootPageResult.parent).toBeNull(); // Root page has no parent
    });

    test('should work without user (guest access) and return type-safe result', async() => {
      const rootPageResult = await pageListingService.findRootByViewer();

      validatePageForTreeItem(rootPageResult);
      expect(rootPageResult.path).toBe('/');
      expect(rootPageResult._id.toString()).toBe(rootPage._id.toString());
    });
  });

  describe('pageListingService.findChildrenByParentPathOrIdAndViewer', () => {
    let childPage1: HydratedDocument<IPage>;

    beforeEach(async() => {
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
      await Page.updateOne(
        { _id: rootPage._id },
        { descendantCount: 2 },
      );
    });

    test('should find children by parent path and return type-safe results', async() => {
      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer('/', testUser);

      expect(children).toHaveLength(2);
      children.forEach((child) => {
        validatePageForTreeItem(child);
        expect(child.parent?.toString()).toBe(rootPage._id.toString());
        expect(['/child1', '/child2']).toContain(child.path);
      });
    });

    test('should find children by parent ID and return type-safe results', async() => {
      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer(rootPage._id.toString(), testUser);

      expect(children).toHaveLength(2);
      children.forEach((child) => {
        validatePageForTreeItem(child);
        expect(child.parent?.toString()).toBe(rootPage._id.toString());
      });
    });

    test('should handle nested children correctly', async() => {
      const nestedChildren = await pageListingService.findChildrenByParentPathOrIdAndViewer('/child1', testUser);

      expect(nestedChildren).toHaveLength(1);
      const grandChild = nestedChildren[0];
      validatePageForTreeItem(grandChild);
      expect(grandChild.path).toBe('/child1/grandchild');
      expect(grandChild.parent?.toString()).toBe(childPage1._id.toString());
    });

    test('should return empty array when no children exist', async() => {
      const noChildren = await pageListingService.findChildrenByParentPathOrIdAndViewer('/child2', testUser);

      expect(noChildren).toHaveLength(0);
      expect(Array.isArray(noChildren)).toBe(true);
    });

    test('should work without user (guest access)', async() => {
      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer('/');

      expect(children).toHaveLength(2);
      children.forEach((child) => {
        validatePageForTreeItem(child);
      });
    });

    test('should sort children by path in ascending order', async() => {
      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer('/', testUser);

      expect(children).toHaveLength(2);
      expect(children[0].path).toBe('/child1');
      expect(children[1].path).toBe('/child2');
    });
  });

  describe('pageListingService processData injection', () => {
    let operatingPage: HydratedDocument<IPage>;

    beforeEach(async() => {
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

    test('should inject processData for pages with operations', async() => {
      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer('/', testUser);

      // Find the operating page in results
      const operatingResult = children.find(child => child.path === '/operating-page');
      expect(operatingResult).toBeDefined();

      // Validate type structure
      if (operatingResult) {
        validatePageForTreeItem(operatingResult);

        // Check that processData was injected
        expect(operatingResult.processData).toBeDefined();
        expect(operatingResult.processData).toBeInstanceOf(Object);
      }
    });

    test('should set processData to undefined for pages without operations', async() => {
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

      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer('/', testUser);
      const normalPage = children.find(child => child.path === '/normal-page');

      expect(normalPage).toBeDefined();
      if (normalPage) {
        validatePageForTreeItem(normalPage);
        expect(normalPage.processData).toBeUndefined();
      }
    });

    test('should maintain type safety with mixed processData scenarios', async() => {
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

      const children = await pageListingService.findChildrenByParentPathOrIdAndViewer('/', testUser);

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
    test('findRootByViewer should return object with correct _id type', async() => {
      const result = await pageListingService.findRootByViewer(testUser);

      // PageQueryBuilder.exec() returns any, but we expect ObjectId-like behavior
      expect(result._id).toBeDefined();
      expect(result._id.toString).toBeDefined();
      expect(typeof result._id.toString()).toBe('string');
      expect(result._id.toString().length).toBe(24); // MongoDB ObjectId string length
    });

    test('findChildrenByParentPathOrIdAndViewer should return array with correct _id types', async() => {
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

      const results = await pageListingService.findChildrenByParentPathOrIdAndViewer('/', testUser);

      expect(Array.isArray(results)).toBe(true);
      results.forEach((result) => {
        // Validate _id behavior from exec() any return type
        expect(result._id).toBeDefined();
        expect(result._id.toString).toBeDefined();
        expect(typeof result._id.toString()).toBe('string');
        expect(result._id.toString().length).toBe(24);

        // Validate parent _id behavior
        if (result.parent) {
          expect(result.parent.toString).toBeDefined();
          expect(typeof result.parent.toString()).toBe('string');
          expect(result.parent.toString().length).toBe(24);
        }
      });
    });

    test('should validate all required IPageForTreeItem fields are present and correctly typed', async() => {
      const result = await pageListingService.findRootByViewer(testUser);

      // These tests ensure that the 'any' return from exec() contains expected structure
      const requiredFields = ['_id', 'path', 'grant', 'isEmpty', 'descendantCount', 'createdAt', 'updatedAt'];

      requiredFields.forEach((field) => {
        expect(result[field]).toBeDefined();
      });

      // Type-specific validations
      expect(typeof result.path).toBe('string');
      expect(typeof result.isEmpty).toBe('boolean');
      expect(typeof result.descendantCount).toBe('number');
      expect(result.createdAt instanceof Date || typeof result.createdAt === 'string').toBe(true);
      expect(result.updatedAt instanceof Date || typeof result.updatedAt === 'string').toBe(true);
    });
  });
});
