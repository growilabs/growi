import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
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
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import {
  mutatePageTree,
  mutateRecentlyUpdated,
  useSWRxPageInfoForList,
} from '~/stores/page-listing';
import { mutateSearching } from '~/stores/search';

type Props = {
  pages: IPageWithSearchMeta[];
  selectedPageId?: string;
  forceHideMenuItems?: ForceHideMenuItems;
  onPageSelected?: (page?: IPageWithSearchMeta) => void;
  onCheckboxChanged?: (isChecked: boolean, pageId: string) => void;
};

const SearchResultListSubstance: ForwardRefRenderFunction<
  ISelectableAll,
  Props
> = (props: Props, ref) => {
  const { pages, selectedPageId, forceHideMenuItems, onPageSelected } = props;

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

  const itemsRef = useRef<(ISelectable | null)[]>([]);

  // publish selectAll()
  useImperativeHandle(ref, () => ({
    selectAll: () => {
      const items = itemsRef.current;
      if (items != null) {
        items.forEach((item) => {
          item?.select();
        });
      }
    },
    deselectAll: () => {
      const items = itemsRef.current;
      if (items != null) {
        items.forEach((item) => {
          item?.deselect();
        });
      }
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

  let injectedPages:
    | (
        | IPageWithSearchMeta
        | IPageWithMeta<IPageInfoForListing & IPageSearchMeta>
      )[]
    | undefined;
  // inject data to list
  if (idToPageInfo != null) {
    injectedPages = pages.map((page) => {
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
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const duplicatedHandler = useCallback(
    (fromPath, toPath) => {
      toastSuccess(t('duplicated_pages', { fromPath }));

      mutatePageTree();
      mutateRecentlyUpdated();
      mutateSearching();
    },
    [t],
  );

  const renamedHandler = useCallback(
    (path) => {
      toastSuccess(t('renamed_pages', { path }));

      mutatePageTree();
      mutateRecentlyUpdated();
      mutateSearching();
    },
    [t],
  );

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
    },
    [t],
  );

  return (
    <ul
      data-testid="search-result-list"
      className="page-list-ul list-group list-group-flush"
    >
      {(injectedPages ?? pages).map((page, i) => {
        return (
          <PageListItemL
            key={page.data._id}
            ref={(c) => {
              itemsRef.current[i] = c;
            }}
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

export const SearchResultList = forwardRef(SearchResultListSubstance);
