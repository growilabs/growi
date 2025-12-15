import type { FC } from 'react';
import React, { useCallback } from 'react';

import type { IPageInfoExt, IPageToDeleteWithMeta } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { DropdownToggle } from 'reactstrap';

import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { bookmark, unbookmark, resumeRenameOperation } from '~/client/services/page-operation';
import { toastError, toastSuccess } from '~/client/util/toastr';
import type { TreeItemToolProps } from '~/features/page-tree/interfaces';
import { useSWRMUTxCurrentUserBookmarks } from '~/stores/bookmark';
import { useSWRMUTxPageInfo } from '~/stores/page';

import { PageItemControl } from '../../Common/Dropdown/PageItemControl';


type UsePageItemControl = {
  Control: FC<TreeItemToolProps>,
}

export const usePageItemControl = (): UsePageItemControl => {
  const { t } = useTranslation();


  const Control: FC<TreeItemToolProps> = (props) => {
    const {
      item,
      isEnableActions,
      isReadOnlyUser,
      onClickDuplicateMenuItem, onClickDeleteMenuItem,
    } = props;
    const page = item.getItemData();

    const { trigger: mutateCurrentUserBookmarks } = useSWRMUTxCurrentUserBookmarks();
    const { trigger: mutatePageInfo } = useSWRMUTxPageInfo(page._id ?? null);

    const bookmarkMenuItemClickHandler = useCallback(async(_pageId: string, _newValue: boolean): Promise<void> => {
      const bookmarkOperation = _newValue ? bookmark : unbookmark;
      await bookmarkOperation(_pageId);
      mutateCurrentUserBookmarks();
      mutatePageInfo();
    }, [mutateCurrentUserBookmarks, mutatePageInfo]);

    const duplicateMenuItemClickHandler = useCallback((): void => {
      if (onClickDuplicateMenuItem == null) {
        return;
      }

      const { _id: pageId, path } = page;

      if (pageId == null || path == null) {
        throw Error('Any of _id and path must not be null.');
      }

      const pageToDuplicate = { pageId, path };

      onClickDuplicateMenuItem(pageToDuplicate);
    }, [onClickDuplicateMenuItem, page]);

    const renameMenuItemClickHandler = useCallback(() => {
      // Use headless-tree's renamingFeature
      item.startRenaming();
    }, [item]);

    const deleteMenuItemClickHandler = useCallback(async(_pageId: string, pageInfo: IPageInfoExt | undefined): Promise<void> => {
      if (onClickDeleteMenuItem == null) {
        return;
      }

      if (page._id == null || page.path == null) {
        throw Error('_id and path must not be null.');
      }

      const pageToDelete: IPageToDeleteWithMeta = {
        data: {
          _id: page._id,
          revision: page.revision != null ? getIdStringForRef(page.revision) : null,
          path: page.path,
        },
        meta: pageInfo,
      };

      onClickDeleteMenuItem(pageToDelete);
    }, [onClickDeleteMenuItem, page]);

    const pathRecoveryMenuItemClickHandler = async(pageId: string): Promise<void> => {
      try {
        await resumeRenameOperation(pageId);
        toastSuccess(t('page_operation.paths_recovered'));
      }
      catch {
        toastError(t('page_operation.path_recovery_failed'));
      }
    };

    return (
      <NotAvailableForGuest>
        <div className="grw-pagetree-control d-flex">
          <PageItemControl
            pageId={page._id}
            isEnableActions={isEnableActions}
            isReadOnlyUser={isReadOnlyUser}
            onClickBookmarkMenuItem={bookmarkMenuItemClickHandler}
            onClickDuplicateMenuItem={duplicateMenuItemClickHandler}
            onClickRenameMenuItem={renameMenuItemClickHandler}
            onClickDeleteMenuItem={deleteMenuItemClickHandler}
            onClickPathRecoveryMenuItem={pathRecoveryMenuItemClickHandler}
            isInstantRename
            // Todo: It is wanted to find a better way to pass operationProcessData to PageItemControl
            operationProcessData={page.processData}
          >
            {/* pass the color property to reactstrap dropdownToggle props. https://6-4-0--reactstrap.netlify.app/components/dropdowns/  */}
            <DropdownToggle color="transparent" className="border-0 rounded btn-page-item-control p-0 mr-1">
              <span id="option-button-in-page-tree" className="material-symbols-outlined p-1">more_vert</span>
            </DropdownToggle>
          </PageItemControl>
        </div>
      </NotAvailableForGuest>
    );
  };


  return {
    Control,
  };

};
