import React from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownItem } from 'reactstrap';

export const BookmarkMoveToRootBtn: React.FC<{
  pageId: string;
  onClickMoveToRootHandler: (pageId: string) => Promise<void>;
}> = React.memo(({ pageId, onClickMoveToRootHandler }) => {
  const { t } = useTranslation();

  return (
    <DropdownItem
      onClick={() => onClickMoveToRootHandler(pageId)}
      className="grw-page-control-dropdown-item"
    >
      <span className="material-symbols-outlined grw-page-control-dropdown-icon">
        bookmark
      </span>
      {t('bookmark_folder.move_to_root')}
    </DropdownItem>
  );
});
BookmarkMoveToRootBtn.displayName = 'BookmarkMoveToRootBtn';
