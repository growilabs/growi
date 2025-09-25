import React, { type JSX } from 'react';

import type { IUserGroupHasId, IUserHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody,
} from 'reactstrap';

import type { SearchType } from '~/interfaces/user-group';
import { SearchTypes } from '~/interfaces/user-group';

import CheckBoxForSerchUserOption from './CheckBoxForSerchUserOption';
import RadioButtonForSerchUserOption from './RadioButtonForSerchUserOption';
import { UserGroupUserFormByInput } from './UserGroupUserFormByInput';

type Props = {
  isOpen: boolean,
  userGroup: IUserGroupHasId,
  searchType: SearchType,
  isAlsoMailSearched: boolean,
  isAlsoNameSearched: boolean,
  onClickAddUserBtn: (username: string) => Promise<void>,
  onSearchApplicableUsers: (searchWord: string) => Promise<IUserHasId[]>,
  onSwitchSearchType: (searchType: SearchType) => void
  onClose: () => void,
  onToggleIsAlsoMailSearched: () => void,
  onToggleIsAlsoNameSearched: () => void,
}

const UserGroupUserModal = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const {
    isOpen,
    userGroup,
    searchType,
    onClickAddUserBtn,
    onSearchApplicableUsers,
    onSwitchSearchType,
    onClose,
    isAlsoMailSearched,
    isAlsoNameSearched,
    onToggleIsAlsoMailSearched,
    onToggleIsAlsoNameSearched,
  } = props;

  return (
    <Modal isOpen={isOpen} toggle={onClose}>
      <ModalHeader tag="h4" toggle={onClose} className="text-info">
        {t('admin:user_group_management.add_modal.add_user') }
      </ModalHeader>
      <ModalBody>
        <p className="card custom-card">{t('admin:user_group_management.add_modal.description')}</p>
        <div className="p-3">
          <UserGroupUserFormByInput
            userGroup={userGroup}
            onClickAddUserBtn={onClickAddUserBtn}
            onSearchApplicableUsers={onSearchApplicableUsers}
            isAlsoNameSearched={isAlsoNameSearched}
            isAlsoMailSearched={isAlsoMailSearched}
            searchType={searchType}
          />
        </div>
        <h2 className="border-bottom">{t('admin:user_group_management.add_modal.search_option')}</h2>
        <div className="row mt-4">
          <div className="col-6">
            <div className="mb-5">
              <CheckBoxForSerchUserOption
                option="mail"
                checked={isAlsoMailSearched}
                onChange={onToggleIsAlsoMailSearched}
              />
            </div>
            <div className="mb-5">
              <CheckBoxForSerchUserOption
                option="name"
                checked={isAlsoNameSearched}
                onChange={onToggleIsAlsoNameSearched}
              />
            </div>
          </div>
          <div className="col-6">
            <div className="mb-5">
              <RadioButtonForSerchUserOption
                searchType="forward"
                checked={searchType === SearchTypes.FORWARD}
                onChange={() => onSwitchSearchType(SearchTypes.FORWARD)}
              />
            </div>
            <div className="mb-5">
              <RadioButtonForSerchUserOption
                searchType="partial"
                checked={searchType === SearchTypes.PARTIAL}
                onChange={() => onSwitchSearchType(SearchTypes.PARTIAL)}
              />
            </div>
            <div className="mb-5">
              <RadioButtonForSerchUserOption
                searchType="backward"
                checked={searchType === SearchTypes.BACKWORD}
                onChange={() => onSwitchSearchType(SearchTypes.BACKWORD)}
              />
            </div>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
};

export default UserGroupUserModal;
