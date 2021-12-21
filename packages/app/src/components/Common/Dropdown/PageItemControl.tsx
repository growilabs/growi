import React, { FC } from 'react';
import {
  UncontrolledDropdown, DropdownMenu, DropdownToggle, DropdownItem,
} from 'reactstrap';

import toastr from 'toastr';
import { useTranslation } from 'react-i18next';

import { IPageHasId } from '~/interfaces/page';

type PageItemControlProps = {
  page: Partial<IPageHasId>
  isEnableActions: boolean
  isDeletable: boolean
  onClickDeleteButton?: (pageId: string) => void
}

const PageItemControl: FC<PageItemControlProps> = (props: PageItemControlProps) => {

  const {
    page, isEnableActions, onClickDeleteButton, isDeletable,
  } = props;
  const { t } = useTranslation('');

  const deleteButtonHandler = () => {
    if (onClickDeleteButton != null && page._id != null) {
      onClickDeleteButton(page._id);
    }
  };
  return (
    <UncontrolledDropdown>
      <DropdownToggle color="transparent" className="btn-link border-0 rounded grw-btn-page-management py-0 px-2">
        <i className="fa fa-ellipsis-v text-muted p-1"></i>
      </DropdownToggle>
      <DropdownMenu positionFixed modifiers={{ preventOverflow: { boundariesElement: undefined } }}>

        {/* TODO: if there is the following button in XD add it here
        <button
          type="button"
          className="btn btn-link p-0"
          value={page.path}
          onClick={(e) => {
            window.location.href = e.currentTarget.value;
          }}
        >
          <i className="icon-login" />
        </button>
        */}

        {/*
          TODO: add function to the following buttons like using modal or others
          ref: https://estoc.weseek.co.jp/redmine/issues/79026
        */}

        {/* TODO: show dropdown when permalink section is implemented */}

        {!isEnableActions && (
          <DropdownItem>
            <p>
              {t('search_result.currently_not_implemented')}
            </p>
          </DropdownItem>
        )}
        {isEnableActions && (
          <DropdownItem onClick={() => toastr.warning(t('search_result.currently_not_implemented'))}>
            <i className="icon-fw icon-star"></i>
            {t('Add to bookmark')}
          </DropdownItem>
        )}
        {isEnableActions && (
          <DropdownItem onClick={() => toastr.warning(t('search_result.currently_not_implemented'))}>
            <i className="icon-fw icon-docs"></i>
            {t('Duplicate')}
          </DropdownItem>
        )}
        {isEnableActions && (
          <DropdownItem onClick={() => toastr.warning(t('search_result.currently_not_implemented'))}>
            <i className="icon-fw  icon-action-redo"></i>
            {t('Move/Rename')}
          </DropdownItem>
        )}
        {isDeletable && isEnableActions && (
          <>
            <DropdownItem divider />
            <DropdownItem className="text-danger pt-2" onClick={deleteButtonHandler}>
              <i className="icon-fw icon-trash"></i>
              {t('Delete')}
            </DropdownItem>
          </>
        )}
      </DropdownMenu>


    </UncontrolledDropdown>
  );

};

export default PageItemControl;
