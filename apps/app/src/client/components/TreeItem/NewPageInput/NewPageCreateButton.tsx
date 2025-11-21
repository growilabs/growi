import type { FC } from 'react';
import React, { useCallback } from 'react';

import { pagePathUtils } from '@growi/core/dist/utils';

import { NotAvailableForGuest } from '~/client/components/NotAvailableForGuest';
import { NotAvailableForReadOnlyUser } from '~/client/components/NotAvailableForReadOnlyUser';
import type { IPageForItem } from '~/interfaces/page';

import type { TreeItemToolProps } from '../../TreeItem';

type NewPageCreateButtonProps = {
  page: IPageForItem,
  onClick?: () => void,
  onStartCreatePage?: (parentId: string, parentPath: string) => void,
};

export const NewPageCreateButton: FC<TreeItemToolProps> = (props) => {
  const {
    item: page, onStartCreatePage,
  } = props;

  const handleClick = useCallback(() => {
    if (onStartCreatePage && page._id && page.path) {
      onStartCreatePage(page._id, page.path);
    }
  }, [onStartCreatePage, page._id, page.path]);

  return (
    <>
      {!pagePathUtils.isUsersTopPage(page.path ?? '') && (
        <NotAvailableForGuest>
          <NotAvailableForReadOnlyUser>
            <button
              id="page-create-button-in-page-tree"
              type="button"
              className="border-0 rounded btn btn-page-item-control p-0"
              onClick={handleClick}
            >
              <span className="material-symbols-outlined p-0">add_circle</span>
            </button>
          </NotAvailableForReadOnlyUser>
        </NotAvailableForGuest>
      )}
    </>
  );
};
