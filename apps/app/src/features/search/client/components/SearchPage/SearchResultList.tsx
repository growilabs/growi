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
  useMemo,
  useRef,
} from 'react';
import {
  type IPageInfoForListing,
  type IPageWithMeta,
  isIPageInfoForListing,
} from '@growi/core/dist/interfaces';
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

type Props = {
  pages: IPageWithSearchMeta[];
  selectedPageId?: string;
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
    selectedPageId,
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

  // Mounted rows keyed by pageId. Each row gets a ref callback created once per
  // pageId: PageListItemL is `memo(forwardRef(...))`, and React compares `ref`
  // identity too, so an inline callback would re-render every row every time.
  // The callback must outlive null calls: PageListItemL's no-deps
  // useImperativeHandle detaches (null) and re-attaches the ref on every
  // re-render of the row, not only on unmount.
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

  // Read by deletedHandler instead of listing them as deps: otherwise every
  // preview switch would hand a new handler to (and so re-render) every row.
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

  return (
    <ul
      data-testid="search-result-list"
      className="page-list-ul list-group list-group-flush"
    >
      {(injectedPages ?? pages).map((page) => {
        return (
          <PageListItemL
            key={page.data._id}
            ref={getItemRefCallback(page.data._id)}
            page={page}
            isEnableActions={!isGuestUser}
            isReadOnlyUser={!!isReadOnlyUser}
            isSelected={page.data._id === selectedPageId}
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
  );
};

export const SearchResultList: ForwardRefExoticComponent<
  Props & RefAttributes<ISelectableAll>
> = forwardRef<ISelectableAll, Props>(SearchResultListSubstance);
