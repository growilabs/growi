import React, { useCallback, useMemo } from 'react';

import { GroupType } from '@growi/core';
import { useTranslation } from 'react-i18next';
import {
  Modal, ModalHeader, ModalBody,
} from 'reactstrap';

import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';

type Props = {
  isOpen: boolean,
  userRelatedGroups?: PopulatedGrantedGroup[],
  selectedUserGroups: PopulatedGrantedGroup[],
  closeModal: () => void,
  onSelect: (userGroup: PopulatedGrantedGroup) => void,
}

const SelectUserGroupModalSubstance: React.FC<Props> = (props: Props) => {
  const {
    userRelatedGroups,
    selectedUserGroups,
    onSelect,
    closeModal,
  } = props;

  const { t } = useTranslation();

  const checked = useCallback((targetUserGroup: PopulatedGrantedGroup) => {
    const selectedUserGroupIds = selectedUserGroups.map(userGroup => userGroup.item._id);
    return selectedUserGroupIds.includes(targetUserGroup.item._id);
  }, [selectedUserGroups]);

  // Memoize user group list
  const userGroupList = useMemo(() => {
    if (userRelatedGroups == null) {
      return null;
    }
    return userRelatedGroups.map(userGroup => (
      <button
        className="btn btn-outline-primary d-flex justify-content-start mb-3 mx-4 align-items-center p-3"
        type="button"
        key={userGroup.item._id}
        onClick={() => onSelect(userGroup)}
      >
        <input type="checkbox" checked={checked(userGroup)} onChange={() => {}} />
        <p className="ms-3 mb-0">{userGroup.item.name}</p>
        {userGroup.type === GroupType.externalUserGroup && <span className="ms-2 badge badge-pill badge-info">{userGroup.item.provider}</span>}
        {/* TODO: Replace <div className="small">(TBD) List group members</div> */}
      </button>
    ));
  }, [userRelatedGroups, onSelect, checked]);

  return (
    <ModalBody className="d-flex flex-column">
      {userGroupList}
      <button
        type="button"
        className="btn btn-primary mt-2 mx-auto"
        onClick={closeModal}
      >
        {t('Done')}
      </button>

    </ModalBody>
  );
};

/**
 * SelectUserGroupModal - Container component (lightweight, always rendered)
 */
export const SelectUserGroupModal: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { isOpen, closeModal } = props;

  return (
    <Modal isOpen={isOpen} toggle={closeModal}>
      {isOpen && (
        <>
          <ModalHeader toggle={closeModal}>
            {t('user_group.select_group')}
          </ModalHeader>
          <SelectUserGroupModalSubstance {...props} />
        </>
      )}
    </Modal>
  );
};
