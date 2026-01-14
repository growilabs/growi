/**
 * Integration tests for use-data-loader with real Jotai atoms
 *
 * These tests verify that the dataLoader correctly reads creating state
 * from Jotai atoms. This is critical because:
 *
 * 1. The dataLoader callbacks (getChildrenWithData) need to read the latest
 *    creating state when they are invoked
 * 2. The dataLoader reference must remain stable to prevent headless-tree
 *    from refetching all data
 * 3. Changes to the creating state must be reflected in subsequent
 *    getChildrenWithData calls WITHOUT recreating the dataLoader
 *
 * These tests use real Jotai atoms instead of mocks to ensure the integration
 * works correctly. This catches bugs like using getDefaultStore() incorrectly.
 */
import type { FC, PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

import type { IPageForTreeItem } from '~/interfaces/page';

import { CREATING_PAGE_VIRTUAL_ID } from '../../constants/_inner';
import { invalidatePageTreeChildren } from '../../services';
// Re-import the actions hook to use real implementation
import {
  resetCreatingFlagForTesting,
  usePageTreeCreateActions,
} from '../../states/_inner';
import { useDataLoader } from './use-data-loader';

/**
 * Type helper to extract getChildrenWithData from TreeDataLoader
 */
type DataLoaderWithChildrenData = ReturnType<typeof useDataLoader> & {
  getChildrenWithData: (
    itemId: string,
  ) => Promise<{ id: string; data: IPageForTreeItem }[]>;
};

/**
 * Combined hook result type for testing both hooks together
 */
type CombinedHookResult = {
  dataLoader: ReturnType<typeof useDataLoader>;
  actions: ReturnType<typeof usePageTreeCreateActions>;
};

// Mock the apiv3Get function
const mockApiv3Get = vi.fn();
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: (...args: unknown[]) => mockApiv3Get(...args),
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
 * Helper to get typed dataLoader with getChildrenWithData
 */
const getDataLoader = (result: {
  current: CombinedHookResult;
}): DataLoaderWithChildrenData => {
  return result.current.dataLoader as DataLoaderWithChildrenData;
};

describe('use-data-loader integration with Jotai atoms', () => {
  const ROOT_PAGE_ID = 'root-page-id';
  const ALL_PAGES_COUNT = 100;

  // Create a fresh Jotai store for each test
  let store: ReturnType<typeof createStore>;

  // Wrapper component that provides the Jotai store
  const createWrapper = (): FC<PropsWithChildren> => {
    const Wrapper: FC<PropsWithChildren> = ({ children }) => (
      <Provider store={store}>{children}</Provider>
    );
    return Wrapper;
  };

  beforeEach(() => {
    // Create fresh store for each test
    store = createStore();
    // Clear pending requests before each test
    invalidatePageTreeChildren();
    // Reset the creating flag for testing
    resetCreatingFlagForTesting();
    // Reset mock
    mockApiv3Get.mockReset();
  });

  describe('placeholder node with real Jotai atoms', () => {
    test('should prepend placeholder when creating state is set via actions hook', async () => {
      const mockChildren = [
        createMockPage('existing-child', '/parent/existing'),
      ];
      mockApiv3Get.mockResolvedValue({ data: { children: mockChildren } });

      const wrapper = createWrapper();

      // Render both hooks together in the same component to share the store
      // and ensure refs are updated when atom state changes
      const { result, rerender } = renderHook(
        (): CombinedHookResult => ({
          dataLoader: useDataLoader(ROOT_PAGE_ID, ALL_PAGES_COUNT),
          actions: usePageTreeCreateActions(),
        }),
        { wrapper },
      );

      // First call - no placeholder (creating state is null)
      const childrenBefore =
        await getDataLoader(result).getChildrenWithData('parent-id');
      expect(childrenBefore).toHaveLength(1);
      expect(childrenBefore[0].id).toBe('existing-child');

      // Set creating state using the actions hook
      act(() => {
        result.current.actions.startCreating('parent-id', '/parent');
      });

      // Rerender to update refs with the new atom state
      rerender();

      // Clear pending requests to force re-fetch
      invalidatePageTreeChildren(['parent-id']);

      // Second call - should have placeholder because atom state changed
      const childrenAfter =
        await getDataLoader(result).getChildrenWithData('parent-id');
      expect(childrenAfter).toHaveLength(2);
      expect(childrenAfter[0].id).toBe(CREATING_PAGE_VIRTUAL_ID);
      expect(childrenAfter[0].data.parent).toBe('parent-id');
      expect(childrenAfter[0].data.path).toBe('/parent/');
      expect(childrenAfter[1].id).toBe('existing-child');
    });

    test('should remove placeholder when creating state is cancelled', async () => {
      const mockChildren = [
        createMockPage('existing-child', '/parent/existing'),
      ];
      mockApiv3Get.mockResolvedValue({ data: { children: mockChildren } });

      const wrapper = createWrapper();

      // Render both hooks together in the same component
      const { result, rerender } = renderHook(
        (): CombinedHookResult => ({
          dataLoader: useDataLoader(ROOT_PAGE_ID, ALL_PAGES_COUNT),
          actions: usePageTreeCreateActions(),
        }),
        { wrapper },
      );

      // Set creating state
      act(() => {
        result.current.actions.startCreating('parent-id', '/parent');
      });

      // Rerender to update refs
      rerender();

      // Clear pending requests and fetch - should have placeholder
      invalidatePageTreeChildren(['parent-id']);
      const childrenWithPlaceholder =
        await getDataLoader(result).getChildrenWithData('parent-id');
      expect(childrenWithPlaceholder).toHaveLength(2);
      expect(childrenWithPlaceholder[0].id).toBe(CREATING_PAGE_VIRTUAL_ID);

      // Cancel creating
      act(() => {
        result.current.actions.cancelCreating();
      });

      // Rerender to update refs
      rerender();

      // Clear pending requests and fetch - should NOT have placeholder
      invalidatePageTreeChildren(['parent-id']);
      const childrenAfterCancel =
        await getDataLoader(result).getChildrenWithData('parent-id');
      expect(childrenAfterCancel).toHaveLength(1);
      expect(childrenAfterCancel[0].id).toBe('existing-child');
    });

    test('dataLoader reference should remain stable when creating state changes via atom', async () => {
      const wrapper = createWrapper();

      // Render both hooks together in the same component
      const { result, rerender } = renderHook(
        (): CombinedHookResult => ({
          dataLoader: useDataLoader(ROOT_PAGE_ID, ALL_PAGES_COUNT),
          actions: usePageTreeCreateActions(),
        }),
        { wrapper },
      );

      const firstDataLoader = result.current.dataLoader;

      // Change creating state via atom
      act(() => {
        result.current.actions.startCreating('some-parent', '/some-parent');
      });

      // Rerender to update refs
      rerender();

      const secondDataLoader = result.current.dataLoader;

      // DataLoader reference should be STABLE (same reference)
      // This is critical to prevent headless-tree from refetching all data
      expect(firstDataLoader).toBe(secondDataLoader);
    });

    test('should correctly read state changes after rerender', async () => {
      // This test verifies that the dataLoader callbacks can read the updated
      // atom state after a React rerender. The refs in useDataLoader are updated
      // during the render cycle, so a rerender is needed to see state changes.

      const mockChildren = [
        createMockPage('existing-child', '/parent/existing'),
      ];
      mockApiv3Get.mockResolvedValue({ data: { children: mockChildren } });

      const wrapper = createWrapper();

      // Render both hooks together in the same component
      const { result, rerender } = renderHook(
        (): CombinedHookResult => ({
          dataLoader: useDataLoader(ROOT_PAGE_ID, ALL_PAGES_COUNT),
          actions: usePageTreeCreateActions(),
        }),
        { wrapper },
      );

      // Get the dataLoader reference BEFORE state change
      const dataLoader = getDataLoader(result);

      // Set creating state
      act(() => {
        result.current.actions.startCreating('parent-id', '/parent');
      });

      // Rerender to update refs
      rerender();

      // Clear pending requests
      invalidatePageTreeChildren(['parent-id']);

      // Call getChildrenWithData using the SAME dataLoader reference
      // This should still see the updated atom state
      const children = await dataLoader.getChildrenWithData('parent-id');

      expect(children).toHaveLength(2);
      expect(children[0].id).toBe(CREATING_PAGE_VIRTUAL_ID);
      expect(children[1].id).toBe('existing-child');
    });

    test('should work with multiple sequential state changes', async () => {
      const mockChildren = [
        createMockPage('existing-child', '/parent/existing'),
      ];
      mockApiv3Get.mockResolvedValue({ data: { children: mockChildren } });

      const wrapper = createWrapper();

      // Render both hooks together in the same component
      const { result, rerender } = renderHook(
        (): CombinedHookResult => ({
          dataLoader: useDataLoader(ROOT_PAGE_ID, ALL_PAGES_COUNT),
          actions: usePageTreeCreateActions(),
        }),
        { wrapper },
      );

      const dataLoader = getDataLoader(result);

      // Sequence: start -> cancel -> start again -> cancel
      // Each time, the dataLoader should correctly reflect the state

      // 1. Start creating
      act(() => {
        result.current.actions.startCreating('parent-id', '/parent');
      });
      rerender();
      invalidatePageTreeChildren(['parent-id']);
      let children = await dataLoader.getChildrenWithData('parent-id');
      expect(children).toHaveLength(2);
      expect(children[0].id).toBe(CREATING_PAGE_VIRTUAL_ID);

      // 2. Cancel
      act(() => {
        result.current.actions.cancelCreating();
      });
      rerender();
      invalidatePageTreeChildren(['parent-id']);
      children = await dataLoader.getChildrenWithData('parent-id');
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe('existing-child');

      // 3. Start again with different parent
      act(() => {
        result.current.actions.startCreating('other-parent', '/other');
      });
      rerender();
      invalidatePageTreeChildren(['parent-id', 'other-parent']);

      // Original parent should NOT have placeholder
      children = await dataLoader.getChildrenWithData('parent-id');
      expect(children).toHaveLength(1);

      // New parent should have placeholder
      mockApiv3Get.mockResolvedValueOnce({ data: { children: [] } });
      children = await dataLoader.getChildrenWithData('other-parent');
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(CREATING_PAGE_VIRTUAL_ID);
      expect(children[0].data.path).toBe('/other/');

      // 4. Cancel again
      act(() => {
        result.current.actions.cancelCreating();
      });
      rerender();
      invalidatePageTreeChildren(['other-parent']);
      mockApiv3Get.mockResolvedValueOnce({ data: { children: [] } });
      children = await dataLoader.getChildrenWithData('other-parent');
      expect(children).toHaveLength(0);
    });
  });
});
