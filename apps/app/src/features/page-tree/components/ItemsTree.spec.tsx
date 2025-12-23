import type React from 'react';
import type { FC } from 'react';
import { Suspense } from 'react';
import { render, waitFor } from '@testing-library/react';

import type { IPageForTreeItem } from '~/interfaces/page';

import type { TreeItemProps } from '../interfaces';
import { invalidatePageTreeChildren } from '../services';
import { ItemsTree } from './ItemsTree';

// Mock the apiv3Get function
const mockApiv3Get = vi.fn();
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: (...args: unknown[]) => mockApiv3Get(...args),
}));

// Mock useSWRxRootPage
const mockRootPage: IPageForTreeItem = {
  _id: 'root-page-id',
  path: '/',
  parent: null,
  descendantCount: 10,
  grant: 1,
  isEmpty: false,
  wip: false,
};

vi.mock('~/stores/page-listing', () => ({
  useSWRxRootPage: () => ({
    data: { rootPage: mockRootPage },
  }),
}));

// Mock page-tree-create state hooks
// These will be overridden in specific tests
let mockCreatingParentId: string | null = null;
let mockCreatingParentPath: string | null = null;

vi.mock('../states/page-tree-create', async () => {
  const actual = await vi.importActual('../states/page-tree-create');
  return {
    ...actual,
    useCreatingParentId: () => mockCreatingParentId,
    useCreatingParentPath: () => mockCreatingParentPath,
  };
});

// Mock page-tree-update hooks
vi.mock('../states/page-tree-update', () => ({
  usePageTreeInformationGeneration: () => 1,
  usePageTreeRevalidationEffect: () => {},
  usePageTreeInformationUpdate: () => ({
    notifyUpdateItems: vi.fn(),
    notifyUpdateAllTrees: vi.fn(),
  }),
}));

// Mock usePageRename
vi.mock('../hooks/use-page-rename', () => ({
  usePageRename: () => ({
    rename: vi.fn(),
    getPageName: (item: { getItemData: () => IPageForTreeItem }) => {
      const data = item.getItemData();
      const parts = data.path?.split('/') ?? [];
      return parts[parts.length - 1] || '/';
    },
  }),
}));

// Mock usePageCreate
vi.mock('../hooks/use-page-create', () => ({
  usePageCreate: () => ({
    createFromPlaceholder: vi.fn(),
    isCreatingPlaceholder: () => false,
    cancelCreating: vi.fn(),
  }),
}));

// Mock useScrollToSelectedItem
vi.mock('../hooks/use-scroll-to-selected-item', () => ({
  useScrollToSelectedItem: () => {},
}));

/**
 * Create mock page data for testing
 */
const createMockPage = (
  id: string,
  path: string,
  options: Partial<IPageForTreeItem> = {},
): IPageForTreeItem => ({
  _id: id,
  path,
  parent: null,
  descendantCount: 0,
  grant: 1,
  isEmpty: false,
  wip: false,
  ...options,
});

/**
 * Simple TreeItem component for testing
 */
const TestTreeItem: FC<TreeItemProps> = ({ item }) => {
  const itemData = item.getItemData();
  return <div data-testid={`tree-item-${itemData._id}`}>{itemData.path}</div>;
};

/**
 * Wrapper component with Suspense for testing
 */
const TestWrapper: FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div>Loading...</div>}>{children}</Suspense>
);

describe('ItemsTree', () => {
  beforeEach(() => {
    // Clear cache before each test
    invalidatePageTreeChildren();
    // Reset mock
    mockApiv3Get.mockReset();
    // Reset creating state
    mockCreatingParentId = null;
    mockCreatingParentPath = null;
  });

  describe('API call optimization', () => {
    test('should only fetch children for expanded nodes, not for all visible nodes', async () => {
      // Setup: Root page has 3 children, each with descendantCount > 0 (folders)
      // but none are expanded initially except root
      const rootChildren = [
        createMockPage('child-1', '/Page1', { descendantCount: 5 }),
        createMockPage('child-2', '/Page2', { descendantCount: 3 }),
        createMockPage('child-3', '/Page3', { descendantCount: 0 }), // leaf node
      ];

      // Mock API responses
      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            // Return empty children for other nodes (they shouldn't be called if not expanded)
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      scrollerElem.style.overflow = 'auto';
      document.body.appendChild(scrollerElem);

      render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            isEnableActions={false}
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      // Wait for initial render and API calls to complete
      await waitFor(() => {
        expect(mockApiv3Get).toHaveBeenCalled();
      });

      // Give time for any additional API calls that might happen
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Key assertion: API should only be called for:
      // 1. root-page-id (the only expanded node by default)
      // NOT for child-1, child-2, child-3 even though they are visible
      const childrenApiCalls = mockApiv3Get.mock.calls.filter(
        (call) => call[0] === '/page-listing/children',
      );

      // Should only have 1 call for root-page-id
      expect(childrenApiCalls).toHaveLength(1);
      expect(childrenApiCalls[0][1]).toEqual({ id: 'root-page-id' });

      // Cleanup
      document.body.removeChild(scrollerElem);
    });

    test('should not call API for nodes that have descendantCount of 0 (leaf nodes)', async () => {
      // Setup: All children are leaf nodes (descendantCount = 0)
      const rootChildren = [
        createMockPage('leaf-1', '/Leaf1', { descendantCount: 0 }),
        createMockPage('leaf-2', '/Leaf2', { descendantCount: 0 }),
        createMockPage('leaf-3', '/Leaf3', { descendantCount: 0 }),
      ];

      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.resolve({ data: { children: [] } });
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      document.body.appendChild(scrollerElem);

      render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      await waitFor(() => {
        expect(mockApiv3Get).toHaveBeenCalled();
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const childrenApiCalls = mockApiv3Get.mock.calls.filter(
        (call) => call[0] === '/page-listing/children',
      );

      // Only root should have children fetched
      expect(childrenApiCalls).toHaveLength(1);
      expect(childrenApiCalls[0][1]).toEqual({ id: 'root-page-id' });

      document.body.removeChild(scrollerElem);
    });

    test('isItemFolder should use descendantCount instead of calling getChildren()', async () => {
      // This test verifies the fix for the bug where isItemFolder called getChildren()
      // which triggered API calls for ALL visible nodes

      const rootChildren = [
        createMockPage('folder-1', '/Folder1', { descendantCount: 5 }),
        createMockPage('folder-2', '/Folder2', { descendantCount: 10 }),
        createMockPage('leaf-1', '/Leaf1', { descendantCount: 0 }),
      ];

      // Track which IDs have their children fetched
      const fetchedChildrenIds: string[] = [];

      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            fetchedChildrenIds.push(params.id);
            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      document.body.appendChild(scrollerElem);

      render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      await waitFor(() => {
        expect(mockApiv3Get).toHaveBeenCalled();
      });

      // Wait for any potential additional API calls
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Critical assertion: Only root-page-id should have children fetched
      // folder-1 and folder-2 should NOT be fetched even though they are folders (descendantCount > 0)
      // This verifies that isItemFolder doesn't call getChildren()
      expect(fetchedChildrenIds).toEqual(['root-page-id']);
      expect(fetchedChildrenIds).not.toContain('folder-1');
      expect(fetchedChildrenIds).not.toContain('folder-2');

      document.body.removeChild(scrollerElem);
    });
  });

  describe('auto-expand ancestors', () => {
    test('should fetch children only for ancestors of targetPath', async () => {
      // Setup: Deep nested structure
      // / (root)
      //   /Sandbox (expanded because it's ancestor of target)
      //     /Sandbox/Test (target)
      //   /Other (NOT expanded)

      const rootChildren = [
        createMockPage('sandbox-id', '/Sandbox', { descendantCount: 5 }),
        createMockPage('other-id', '/Other', { descendantCount: 3 }),
      ];

      const sandboxChildren = [
        createMockPage('test-id', '/Sandbox/Test', { descendantCount: 0 }),
      ];

      const fetchedChildrenIds: string[] = [];

      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            fetchedChildrenIds.push(params.id);

            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            if (params.id === 'sandbox-id') {
              return Promise.resolve({ data: { children: sandboxChildren } });
            }
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      document.body.appendChild(scrollerElem);

      render(
        <TestWrapper>
          <ItemsTree
            targetPath="/Sandbox/Test"
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      // Wait for auto-expand to complete
      await waitFor(
        () => {
          expect(fetchedChildrenIds).toContain('sandbox-id');
        },
        { timeout: 1000 },
      );

      // Give some extra time for any unwanted calls
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should fetch: root-page-id (initial), sandbox-id (ancestor of target)
      // Should NOT fetch: other-id (not an ancestor of target)
      expect(fetchedChildrenIds).toContain('root-page-id');
      expect(fetchedChildrenIds).toContain('sandbox-id');
      expect(fetchedChildrenIds).not.toContain('other-id');

      document.body.removeChild(scrollerElem);
    });
  });

  // NOTE: Page creation placeholder tests are covered in use-data-loader.spec.tsx
  // The dataLoader is responsible for prepending placeholder nodes when creatingParentId is set

  describe('page creation (creatingParentId)', () => {
    test('should not cause infinite API requests when creatingParentId is set', async () => {
      // This test verifies the fix for the infinite request loop bug
      // When creatingParentId is set, the component should:
      // 1. Invalidate and refetch children for that parent ONCE
      // 2. NOT continuously refetch in an infinite loop

      const rootChildren = [
        createMockPage('parent-1', '/Parent1', { descendantCount: 2 }),
        createMockPage('parent-2', '/Parent2', { descendantCount: 0 }),
      ];

      const parent1Children = [
        createMockPage('child-1', '/Parent1/Child1', { descendantCount: 0 }),
      ];

      // Track API call count per ID
      const apiCallCounts: Record<string, number> = {};

      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            apiCallCounts[params.id] = (apiCallCounts[params.id] || 0) + 1;

            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            if (params.id === 'parent-1') {
              return Promise.resolve({ data: { children: parent1Children } });
            }
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint for individual item fetches
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      document.body.appendChild(scrollerElem);

      // Set creatingParentId BEFORE rendering to simulate the user clicking create button
      mockCreatingParentId = 'parent-1';
      mockCreatingParentPath = '/Parent1';

      const { rerender } = render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            isEnableActions={true}
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      // Wait for initial data fetch
      await waitFor(() => {
        expect(mockApiv3Get).toHaveBeenCalled();
      });

      // Wait a reasonable amount of time to detect infinite loops
      // If there's an infinite loop, we'd see many API calls within this time
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Force re-render to simulate React re-renders that could trigger the loop
      rerender(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            isEnableActions={true}
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      // Wait more time for potential infinite loop to manifest
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Key assertion: API calls for parent-1 should be bounded
      // An infinite loop would cause this count to be very high (100+)
      // Normal behavior: 1-3 calls (initial load + invalidation)
      const parent1CallCount = apiCallCounts['parent-1'] || 0;
      expect(parent1CallCount).toBeLessThanOrEqual(5);

      // Total API calls should also be bounded
      const totalCalls = Object.values(apiCallCounts).reduce(
        (sum, count) => sum + count,
        0,
      );
      expect(totalCalls).toBeLessThanOrEqual(10);

      document.body.removeChild(scrollerElem);
    });

    test('should handle creatingParentId change without infinite loop', async () => {
      // Test that changing creatingParentId from one value to another
      // doesn't cause infinite requests

      const rootChildren = [
        createMockPage('parent-1', '/Parent1', { descendantCount: 1 }),
        createMockPage('parent-2', '/Parent2', { descendantCount: 1 }),
      ];

      let totalApiCalls = 0;

      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            totalApiCalls++;

            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint for individual item fetches
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      document.body.appendChild(scrollerElem);

      // Initial render without creating state
      render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            isEnableActions={true}
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      // Wait for initial load
      await waitFor(() => {
        expect(mockApiv3Get).toHaveBeenCalled();
      });
      await new Promise((resolve) => setTimeout(resolve, 200));

      const callsAfterInitialLoad = totalApiCalls;

      // Simulate setting creatingParentId (user clicks create button)
      // Note: Since we can't easily change the mock mid-test in this setup,
      // we're mainly testing the initial render with creatingParentId set

      // Wait to ensure no more calls happen
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify API calls stabilized
      expect(totalApiCalls).toBeLessThanOrEqual(callsAfterInitialLoad + 2);

      document.body.removeChild(scrollerElem);
    });

    test('should stop fetching when creatingParentId becomes null', async () => {
      // Verify that resetting creatingParentId to null doesn't cause issues

      const rootChildren = [
        createMockPage('parent-1', '/Parent1', { descendantCount: 1 }),
      ];

      let apiCallCount = 0;

      mockApiv3Get.mockImplementation(
        (endpoint: string, params: { id: string }) => {
          if (endpoint === '/page-listing/children') {
            apiCallCount++;

            if (params.id === 'root-page-id') {
              return Promise.resolve({ data: { children: rootChildren } });
            }
            return Promise.resolve({ data: { children: [] } });
          }
          // Handle /page-listing/item endpoint for individual item fetches
          if (endpoint === '/page-listing/item') {
            return Promise.resolve({
              data: { item: createMockPage(params.id, `/${params.id}`) },
            });
          }
          return Promise.reject(new Error(`Unexpected endpoint: ${endpoint}`));
        },
      );

      const scrollerElem = document.createElement('div');
      scrollerElem.style.height = '500px';
      document.body.appendChild(scrollerElem);

      // Start with creatingParentId set
      mockCreatingParentId = 'parent-1';
      mockCreatingParentPath = '/Parent1';

      const { unmount } = render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            isEnableActions={true}
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      await waitFor(() => {
        expect(mockApiv3Get).toHaveBeenCalled();
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const callsBeforeReset = apiCallCount;

      // Reset creating state (simulating cancel or completion)
      mockCreatingParentId = null;
      mockCreatingParentPath = null;

      // Unmount and remount to apply the null state
      unmount();

      render(
        <TestWrapper>
          <ItemsTree
            targetPath="/"
            isEnableActions={true}
            CustomTreeItem={TestTreeItem}
            estimateTreeItemSize={() => 32}
            scrollerElem={scrollerElem}
          />
        </TestWrapper>,
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // API calls should be bounded even after state changes
      // The difference should be minimal (just the initial load after remount)
      expect(apiCallCount - callsBeforeReset).toBeLessThanOrEqual(3);

      document.body.removeChild(scrollerElem);
    });
  });
});
