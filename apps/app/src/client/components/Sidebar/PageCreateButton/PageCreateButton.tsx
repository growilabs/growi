import React, { type JSX, useState } from 'react';
import { Dropdown } from 'reactstrap';

import { useCreateTemplatePage } from '~/client/services/create-page';
import { useToastrOnError } from '~/client/services/use-toastr-on-error';
import { useCurrentPagePath } from '~/states/page';
import { usePageCreateModalActions } from '~/states/ui/modal/page-create';

import { CreateButton } from './CreateButton';
import { DropendMenu } from './DropendMenu';
import { DropendToggle } from './DropendToggle';
import { useCreateNewPage, useCreateTodaysMemo } from './hooks';

import styles from './PageCreateButton.module.scss';

export const PageCreateButton = React.memo((): JSX.Element => {
  const [isHovered, setIsHovered] = useState(false);
  const [hasHovered, setHasHovered] = useState(false);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { open: openPageCreateModal } = usePageCreateModalActions();
  const currentPagePath = useCurrentPagePath();

  const { createNewPage, isCreating: isNewPageCreating } = useCreateNewPage();
  // TODO: https://redmine.weseek.co.jp/issues/138806
  const {
    createTodaysMemo,
    isCreating: isTodaysPageCreating,
    todaysPath,
  } = useCreateTodaysMemo();
  // TODO: https://redmine.weseek.co.jp/issues/138805
  const {
    createTemplate,
    isCreating: isTemplatePageCreating,
    isCreatable: isTemplatePageCreatable,
  } = useCreateTemplatePage();

  const createNewPageWithToastr = useToastrOnError(createNewPage);
  const createTodaysMemoWithToastr = useToastrOnError(createTodaysMemo);
  const createTemplateWithToastr = useToastrOnError(createTemplate);

  const onMouseEnterHandler = () => {
    setIsHovered(true);
    setHasHovered(true);
  };

  const onMouseLeaveHandler = () => {
    if (!dropdownOpen) setIsHovered(false);
  };

  const toggle = () => {
    const next = !dropdownOpen;
    setDropdownOpen(next);
    if (!next) setIsHovered(false);
  };

  return (
    <fieldset
      className="d-flex flex-row mt-2 border-0 p-0 m-0"
      onMouseEnter={onMouseEnterHandler}
      onMouseLeave={onMouseLeaveHandler}
      data-testid="grw-page-create-button"
      aria-label="Page create actions"
    >
      <div className="btn-group flex-grow-1">
        <CreateButton
          className="z-2"
          onClick={createNewPageWithToastr}
          disabled={
            isNewPageCreating || isTodaysPageCreating || isTemplatePageCreating
          }
        />
      </div>
      <Dropdown
        isOpen={dropdownOpen}
        toggle={toggle}
        direction="end"
        className={[
          'position-absolute',
          styles['dropend-wrapper'],
          hasHovered ? styles['has-hovered'] : '',
          isHovered ? styles['is-hovered'] : '',
        ].join(' ')}
      >
        <DropendToggle isOpen={dropdownOpen} isVisible={isHovered} />
        <DropendMenu
          onClickCreateNewPage={createNewPageWithToastr}
          onClickOpenPageCreateModal={() =>
            openPageCreateModal(currentPagePath)
          }
          onClickCreateTodaysMemo={createTodaysMemoWithToastr}
          onClickCreateTemplate={
            isTemplatePageCreatable ? createTemplateWithToastr : undefined
          }
          todaysPath={todaysPath}
        />
      </Dropdown>
    </fieldset>
  );
});
