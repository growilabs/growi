import React, { useState, type JSX } from 'react';

import { Dropdown } from 'reactstrap';

import { useCreateTemplatePage } from '~/client/services/create-page';
import { useToastrOnError } from '~/client/services/use-toastr-on-error';
import { useCurrentPagePath } from '~/states/page';
import { usePageCreateModalActions } from '~/states/ui/modal/page-create';

import { CreateButton } from './CreateButton';
import { DropendMenu } from './DropendMenu';
import { DropendToggle } from './DropendToggle';
import { useCreateNewPage, useCreateTodaysMemo } from './hooks';


export const PageCreateButton = React.memo((): JSX.Element => {
  const [isHovered, setIsHovered] = useState(false);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { open: openPageCreateModal } = usePageCreateModalActions();
  const currentPagePath = useCurrentPagePath();

  const { createNewPage, isCreating: isNewPageCreating } = useCreateNewPage();
  // TODO: https://redmine.weseek.co.jp/issues/138806
  const { createTodaysMemo, isCreating: isTodaysPageCreating, todaysPath } = useCreateTodaysMemo();
  // TODO: https://redmine.weseek.co.jp/issues/138805
  const {
    createTemplate,
    isCreating: isTemplatePageCreating, isCreatable: isTemplatePageCreatable,
  } = useCreateTemplatePage();

  const createNewPageWithToastr = useToastrOnError(createNewPage);
  const createTodaysMemoWithToastr = useToastrOnError(createTodaysMemo);
  const createTemplateWithToastr = useToastrOnError(createTemplate);

  const onMouseEnterHandler = () => {
    setIsHovered(true);
  };

  const onMouseLeaveHandler = () => {
    setIsHovered(false);
    setDropdownOpen(false);
  };

  const toggle = () => setDropdownOpen(!dropdownOpen);

  return (
    <div
      className="d-flex flex-row mt-2"
      onMouseEnter={onMouseEnterHandler}
      onMouseLeave={onMouseLeaveHandler}
      data-testid="grw-page-create-button"
    >
      <div className="btn-group flex-grow-1">
        <CreateButton
          className="z-2"
          onClick={createNewPageWithToastr}
          disabled={isNewPageCreating || isTodaysPageCreating || isTemplatePageCreating}
        />
      </div>
      { isHovered && (
        <Dropdown
          isOpen={dropdownOpen}
          toggle={toggle}
          direction="end"
          className="position-absolute"
        >
          <DropendToggle />
          <DropendMenu
            onClickCreateNewPage={createNewPageWithToastr}
            onClickOpenPageCreateModal={() => openPageCreateModal(currentPagePath)}
            onClickCreateTodaysMemo={createTodaysMemoWithToastr}
            onClickCreateTemplate={isTemplatePageCreatable ? createTemplateWithToastr : undefined}
            todaysPath={todaysPath}
          />
        </Dropdown>
      )}
    </div>
  );
});
