import type {
  ForwardRefExoticComponent,
  ForwardRefRenderFunction,
  RefAttributes,
} from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type IPageInfoForListing,
  type IPageWithMeta,
  isIPageInfoForListing,
} from '@growi/core/dist/interfaces';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'next-i18next';

import type { ForceHideMenuItems } from '~/client/components/Common/Dropdown/PageItemControl';
import { PageListItemL } from '~/client/components/PageList/PageListItemL';
import type {
  ISelectable,
  ISelectableAll,
} from '~/client/interfaces/selectable-all';
import { toastSuccess } from '~/client/util/toastr';
import type { IPageSearchMeta, IPageWithSearchMeta } from '~/interfaces/search';
import type { OnRenamedFunction } from '~/interfaces/ui';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import {
  mutatePageTree,
  mutateRecentlyUpdated,
  useSWRxPageInfoForList,
} from '~/stores/page-listing';
import { mutateSearching } from '~/stores/search';

import type { SearchItemMutation } from '../../util/apply-search-item-mutation';

// The rows' CSS min-height (`.list-group-item` in
// packages/ui/scss/molecules/_page_list.scss), so an estimate never undershoots.
// Rendered rows are re-measured; this only affects rows not rendered yet.
export const ESTIMATED_SEARCH_RESULT_ROW_HEIGHT = 136;
const OVERSCAN_ROW_COUNT = 5;

const estimateRowSize = (): number => ESTIMATED_SEARCH_RESULT_ROW_HEIGHT;

type Props = {
  pages: IPageWithSearchMeta[];
  // The element that scrolls the list. No rows are rendered while it is null.
  scrollElement: HTMLElement | null;
  selectedPageId?: string;
  // Checked pages, including rows outside the rendered range. Rows scrolled
  // back into range remount and take their initial checkbox state from it, so
  // the caller must keep it current (selectAll/deselectAll reach mounted rows only).
  selectedPageIds?: ReadonlySet<string>;
  // Each row's `aria-setsize`: -1 while the total is still unknown. Defaults to
  // the loaded count.
  listSize?: number;
  forceHideMenuItems?: ForceHideMenuItems;
  onPageSelected?: (page?: IPageWithSearchMeta) => void;
  onCheckboxChanged?: (isChecked: boolean, pageId: string) => void;
  // Called in addition to `mutateSearching()` after a single-row rename /
  // delete, describing what changed. `mutateSearching()`'s filtered `mutate`
  // never reaches an active `useSWRInfinite` subscription (SWR skips
  // `$inf$`-prefixed keys), so the infinite-scroll caller applies the change to
  // its own cache here (A-1). Duplication is not reported: it never changes an
  // existing row.
  onItemMutated?: (mutation: SearchItemMutation) => void;
  // Called when the row deleted via its OWN dropdown menu is the one currently
  // shown in the right-pane preview (`selectedPageId`). The preview is keyed
  // off a snapshot object independent of `pages`, so revalidating the list
  // (mutateSearching/onItemMutated) removes the row but never clears a preview
  // pointing at data that no longer exists — the right pane would keep
  // rendering a page that is gone from the results.
  onPreviewedPageDeleted?: () => void;
};

const SearchResultListSubstance: ForwardRefRenderFunction<
  ISelectableAll,
  Props
> = (props: Props, ref) => {
  const {
    pages,
    scrollElement,
    selectedPageId,
    selectedPageIds,
    listSize = pages.length,
    forceHideMenuItems,
    onPageSelected,
    onItemMutated,
    onPreviewedPageDeleted,
  } = props;

  const { t } = useTranslation();

  const pageIdsWithNoSnippet = pages
    .filter(
      (page) => (page.meta?.elasticSearchResult?.snippet?.length ?? 0) === 0,
    )
    .map((page) => page.data._id);

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const { data: idToPageInfo } = useSWRxPageInfoForList(
    pageIdsWithNoSnippet,
    null,
    true,
    true,
  );

  // One stable ref callback per pageId (see design.md, SearchResultList). It
  // must outlive null calls: PageListItemL's no-deps useImperativeHandle
  // detaches and re-attaches the ref on every re-render of the row.
  const itemsRef = useRef(new Map<string, ISelectable>());
  const itemRefCallbacksRef = useRef(
    new Map<string, (item: ISelectable | null) => void>(),
  );

  const getItemRefCallback = useCallback((pageId: string) => {
    const callbacks = itemRefCallbacksRef.current;
    const existing = callbacks.get(pageId);
    if (existing != null) {
      return existing;
    }

    const callback = (item: ISelectable | null) => {
      if (item != null) {
        itemsRef.current.set(pageId, item);
        return;
      }
      itemsRef.current.delete(pageId);
    };
    callbacks.set(pageId, callback);
    return callback;
  }, []);

  // Bound the callback cache to the rows that can still be rendered.
  useEffect(() => {
    const pageIds = new Set(pages.map((page) => page.data._id));
    itemRefCallbacksRef.current.forEach((_callback, pageId) => {
      if (!pageIds.has(pageId)) {
        itemRefCallbacksRef.current.delete(pageId);
      }
    });
  }, [pages]);

  // publish selectAll()
  useImperativeHandle(ref, () => ({
    selectAll: () => {
      itemsRef.current.forEach((item) => {
        item.select();
      });
    },
    deselectAll: () => {
      itemsRef.current.forEach((item) => {
        item.deselect();
      });
    },
  }));

  const clickItemHandler = useCallback(
    (pageId: string) => {
      if (onPageSelected != null) {
        const selectedPage = pages.find((page) => page.data._id === pageId);
        onPageSelected(selectedPage);
      }
    },
    [onPageSelected, pages],
  );

  // inject data to list
  const injectedPages = useMemo(() => {
    if (idToPageInfo == null) {
      return undefined;
    }

    return pages.map(
      (
        page,
      ):
        | IPageWithSearchMeta
        | IPageWithMeta<IPageInfoForListing & IPageSearchMeta> => {
        const pageInfo = idToPageInfo[page.data._id];

        if (!isIPageInfoForListing(pageInfo)) {
          // return as is
          return page;
        }

        return {
          data: page.data,
          meta: {
            ...page.meta,
            ...pageInfo,
          },
        } satisfies IPageWithMeta<IPageInfoForListing & IPageSearchMeta>;
      },
    );
  }, [pages, idToPageInfo]);

  const duplicatedHandler = useCallback(
    (fromPath, _toPath) => {
      toastSuccess(t('duplicated_pages', { fromPath }));

      mutatePageTree();
      mutateRecentlyUpdated();
      mutateSearching();
    },
    [t],
  );

  const renamedHandler = useCallback<OnRenamedFunction>(
    (path, newPath) => {
      toastSuccess(t('renamed_pages', { path }));

      mutatePageTree();
      mutateRecentlyUpdated();
      mutateSearching();
      onItemMutated?.({ type: 'renamed', fromPath: path, toPath: newPath });
    },
    [t, onItemMutated],
  );

  // Read via refs to keep deletedHandler stable (see design.md, SearchResultList).
  const latestPagesRef = useRef(pages);
  latestPagesRef.current = pages;
  const latestSelectedPageIdRef = useRef(selectedPageId);
  latestSelectedPageIdRef.current = selectedPageId;

  const deletedHandler = useCallback(
    (pathOrPathsToDelete, isRecursively, isCompletely) => {
      if (typeof pathOrPathsToDelete !== 'string') {
        return;
      }

      const path = pathOrPathsToDelete;

      if (isCompletely) {
        toastSuccess(t('deleted_pages_completely', { path }));
      } else {
        toastSuccess(t('deleted_pages', { path }));
      }
      mutatePageTree();
      mutateRecentlyUpdated();
      mutateSearching();
      onItemMutated?.({
        type: 'deleted',
        path,
        isRecursively: isRecursively === true,
      });

      const previewedPage = latestPagesRef.current.find(
        (page) => page.data._id === latestSelectedPageIdRef.current,
      );
      if (previewedPage?.data.path === path) {
        onPreviewedPageDeleted?.();
      }
    },
    [t, onItemMutated, onPreviewedPageDeleted],
  );

  const listContainerRef = useRef<HTMLDivElement>(null);
  // Where the list starts inside the scroll element (below the result header).
  // Re-measured after every render (no deps) because the header above the list
  // can change height on any parent render; React skips the re-render when the
  // value is unchanged. A ResizeObserver on the header would couple this list
  // to the parent's DOM structure instead.
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    setScrollMargin(listContainerRef.current?.offsetTop ?? 0);
  });

  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const getItemKey = useCallback(
    (index: number) => pages[index].data._id,
    [pages],
  );

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement,
    estimateSize: estimateRowSize,
    overscan: OVERSCAN_ROW_COUNT,
    getItemKey,
    scrollMargin,
  });

  // Empty until the scroll element is available.
  const virtualItems = virtualizer.getVirtualItems();
  const renderedRangeOffset =
    virtualItems.length > 0 ? virtualItems[0].start - scrollMargin : 0;
  const rows = injectedPages ?? pages;

  return (
    <div
      ref={listContainerRef}
      className="position-relative"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      <ul
        data-testid="search-result-list"
        className="page-list-ul list-group list-group-flush position-absolute top-0 start-0 w-100"
        style={{
          transform: `translateY(${renderedRangeOffset}px)`,
        }}
      >
        {virtualItems.map((virtualItem) => {
          const page = rows[virtualItem.index];
          return (
            <PageListItemL
              key={virtualItem.key}
              ref={getItemRefCallback(page.data._id)}
              listItemRef={virtualizer.measureElement}
              listItemIndex={virtualItem.index}
              listSize={listSize}
              page={page}
              isEnableActions={!isGuestUser}
              isReadOnlyUser={!!isReadOnlyUser}
              isSelected={page.data._id === selectedPageId}
              isInitiallyChecked={selectedPageIds?.has(page.data._id)}
              forceHideMenuItems={forceHideMenuItems}
              onClickItem={clickItemHandler}
              onCheckboxChanged={props.onCheckboxChanged}
              onPageDuplicated={duplicatedHandler}
              onPageRenamed={renamedHandler}
              onPageDeleted={deletedHandler}
            />
          );
        })}
      </ul>
    </div>
  );
};

export const SearchResultList: ForwardRefExoticComponent<
  Props & RefAttributes<ISelectableAll>
> = forwardRef<ISelectableAll, Props>(SearchResultListSubstance);
