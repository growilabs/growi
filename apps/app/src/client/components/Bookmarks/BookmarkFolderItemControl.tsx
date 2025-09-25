import React, { useState, type JSX } from 'react';

import { useTranslation } from 'next-i18next';
import {
  Dropdown, DropdownItem, DropdownMenu, DropdownToggle,
} from 'reactstrap';

export const BookmarkFolderItemControl: React.FC<{
  children?: React.ReactNode
  onClickMoveToRoot?: () => Promise<void>
  onClickRename: () => void
  onClickDelete: () => void
}> = ({
  children,
  onClickMoveToRoot,
  onClickRename,
  onClickDelete,
}): JSX.Element => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dropdown isOpen={isOpen} toggle={() => setIsOpen(!isOpen)}>
      { children ?? (
        <DropdownToggle color="transparent" className="border-0 rounded btn-page-item-control d-flex align-items-center justify-content-center">
          <span className="material-symbols-outlined">more_horiz</span>
        </DropdownToggle>
      ) }

      { isOpen && (
        <DropdownMenu
          container="body"
          style={{ zIndex: 1055 }}
        >
          {onClickMoveToRoot && (
            <DropdownItem
              onClick={onClickMoveToRoot}
              className="grw-page-control-dropdown-item"
            >
              <span className="material-symbols-outlined grw-page-control-dropdown-icon">bookmark</span>
              {t('bookmark_folder.move_to_root')}
            </DropdownItem>
          )}
          <DropdownItem
            onClick={onClickRename}
            className="grw-page-control-dropdown-item"
          >
            <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">redo</span>
            {t('Rename')}
          </DropdownItem>

          <DropdownItem divider />

          <DropdownItem
            className="pt-2 grw-page-control-dropdown-item text-danger"
            onClick={onClickDelete}
          >
            <span className="material-symbols-outlined me-1 grw-page-control-dropdown-icon">delete</span>
            {t('Delete')}
          </DropdownItem>
        </DropdownMenu>
      ) }
    </Dropdown>
  );
};
