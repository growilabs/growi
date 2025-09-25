import React, { type JSX } from 'react';

import { useTranslation } from 'react-i18next';
import { DropdownMenu, DropdownItem } from 'reactstrap';

import type { LabelType } from '~/interfaces/template';


type DropendMenuProps = {
  onClickCreateNewPage: () => Promise<void>
  onClickOpenPageCreateModal: () => void
  onClickCreateTodaysMemo: () => Promise<void>
  onClickCreateTemplate?: (label: LabelType) => Promise<void>
  todaysPath: string | null,
}

export const DropendMenu = React.memo((props: DropendMenuProps): JSX.Element => {
  const {
    onClickCreateNewPage,
    onClickOpenPageCreateModal,
    onClickCreateTodaysMemo,
    onClickCreateTemplate,
    todaysPath,
  } = props;

  const { t } = useTranslation('commons');

  return (
    <DropdownMenu
      container="body"
      data-testid="grw-page-create-button-dropend-menu"
    >
      <DropdownItem
        onClick={onClickCreateNewPage}
      >
        {t('create_page_dropdown.new_page')}
      </DropdownItem>

      <DropdownItem
        onClick={onClickOpenPageCreateModal}
      >
        {t('create_page_dropdown.open_page_create_modal')}
      </DropdownItem>


      { todaysPath != null && (
        <>
          <DropdownItem divider />
          <li><span className="text-muted px-3">{t('create_page_dropdown.todays.desc')}</span></li>
          <DropdownItem
            aria-label="Create today page"
            onClick={onClickCreateTodaysMemo}
          >
            {todaysPath}
          </DropdownItem>
        </>
      )}

      { onClickCreateTemplate != null && (
        <>
          <DropdownItem divider />
          <li><span className="text-muted text-nowrap px-3">{t('create_page_dropdown.template.desc')}</span></li>
          <DropdownItem
            onClick={() => onClickCreateTemplate('_template')}
          >
            {t('create_page_dropdown.template.children')}
          </DropdownItem>
          <DropdownItem
            onClick={() => onClickCreateTemplate('__template')}
          >
            {t('create_page_dropdown.template.descendants')}
          </DropdownItem>
        </>
      ) }
    </DropdownMenu>
  );
});
DropendMenu.displayName = 'DropendMenu';
