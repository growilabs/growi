import type { FC } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import {
  getIdStringForRef,
  type IGrantedGroup,
  type IUserGroupHasId,
  isPopulated,
} from '@growi/core';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import { PageActionOnGroupDelete } from '~/interfaces/user-group';

/**
 * Delete User Group Select component
 *
 * @export
 * @class GrantSelector
 * @extends {React.Component}
 */
type Props = {
  userGroups: IGrantedGroup[];
  deleteUserGroup?: IUserGroupHasId;
  onDelete?: (
    deleteGroupId: string,
    actionName: PageActionOnGroupDelete,
    transferToUserGroup: IGrantedGroup | null,
  ) => Promise<void> | void;
  isShow: boolean;
  onHide?: () => Promise<void> | void;
};

type AvailableOption = {
  id: number;
  actionForPages: PageActionOnGroupDelete;
  label: string;
};

export const UserGroupDeleteModal: FC<Props> = (props: Props) => {
  const { t } = useTranslation();

  const { onHide, onDelete, userGroups, deleteUserGroup } = props;

  const availableOptions = useMemo<AvailableOption[]>(() => {
    return [
      {
        id: 1,
        actionForPages: PageActionOnGroupDelete.publicize,
        label: t('admin:user_group_management.delete_modal.publish_pages'),
      },
      {
        id: 2,
        actionForPages: PageActionOnGroupDelete.delete,
        label: t('admin:user_group_management.delete_modal.delete_pages'),
      },
      {
        id: 3,
        actionForPages: PageActionOnGroupDelete.transfer,
        label: t('admin:user_group_management.delete_modal.transfer_pages'),
      },
    ];
  }, [t]);

  /*
   * State
   */
  const [actionName, setActionName] = useState<PageActionOnGroupDelete | null>(
    null,
  );
  const [transferToUserGroup, setTransferToUserGroup] =
    useState<IGrantedGroup | null>(null);

  /*
   * Function
   */
  const resetStates = useCallback(() => {
    setActionName(null);
    setTransferToUserGroup(null);
  }, []);

  const toggleHandler = useCallback(() => {
    if (onHide == null) {
      return;
    }

    resetStates();
    onHide();
  }, [onHide, resetStates]);

  const handleActionChange = useCallback((e) => {
    const actionName = e.target.value;
    setActionName(actionName);
  }, []);

  const handleGroupChange = useCallback(
    (e) => {
      const transferToUserGroupId: string = e.target.value;
      const selectedGroup =
        userGroups.find(
          (group) => getIdStringForRef(group.item) === transferToUserGroupId,
        ) ?? null;
      setTransferToUserGroup(selectedGroup);
    },
    [userGroups],
  );

  const handleSubmit = useCallback(
    (e) => {
      if (onDelete == null || deleteUserGroup == null || actionName == null) {
        return;
      }

      e.preventDefault();

      onDelete(deleteUserGroup._id, actionName, transferToUserGroup);
    },
    [onDelete, deleteUserGroup, actionName, transferToUserGroup],
  );

  const renderPageActionSelector = useCallback(() => {
    const options = availableOptions.map((opt) => {
      return (
        <option key={opt.id} value={opt.actionForPages}>
          {opt.label}
        </option>
      );
    });

    // TODO: Use GROWI original dropdown.
    // refs: https://redmine.weseek.co.jp/issues/142614
    return (
      <select
        name="actionName"
        className="form-control"
        value={actionName ?? ''}
        onChange={handleActionChange}
      >
        <option value="" disabled>
          {t('admin:user_group_management.delete_modal.dropdown_desc')}
        </option>
        {options}
      </select>
    );
  }, [availableOptions, actionName, handleActionChange, t]);

  const renderGroupSelector = useCallback(() => {
    if (deleteUserGroup == null) {
      return;
    }

    const groups = userGroups.filter((group) => {
      return getIdStringForRef(group.item) !== deleteUserGroup._id;
    });

    const options = groups
      .map((group) => {
        const groupId = getIdStringForRef(group.item);
        const groupName = isPopulated(group.item) ? group.item.name : null;
        return { id: groupId, name: groupName };
      })
      .filter((obj) => obj.name != null)
      .map((obj) => (
        <option key={obj.id} value={obj.id}>
          {obj.name}
        </option>
      ));

    const defaultOptionText =
      groups.length === 0
        ? t('admin:user_group_management.delete_modal.no_groups')
        : t('admin:user_group_management.delete_modal.select_group');

    return (
      <select
        name="transferToUserGroup"
        className={`form-control ${actionName === PageActionOnGroupDelete.transfer ? '' : 'd-none'}`}
        value={
          transferToUserGroup != null
            ? getIdStringForRef(transferToUserGroup.item)
            : ''
        }
        onChange={handleGroupChange}
      >
        <option value="" disabled>
          {defaultOptionText}
        </option>
        {options}
      </select>
    );
  }, [
    deleteUserGroup,
    userGroups,
    t,
    actionName,
    transferToUserGroup,
    handleGroupChange,
  ]);

  const validateForm = useCallback(() => {
    let isValid = true;

    if (actionName === null) {
      isValid = false;
    } else if (actionName === PageActionOnGroupDelete.transfer) {
      isValid = transferToUserGroup != null;
    }

    return isValid;
  }, [actionName, transferToUserGroup]);

  return (
    <Modal className="modal-md" isOpen={props.isShow} toggle={toggleHandler}>
      <ModalHeader tag="h4" toggle={toggleHandler}>
        <span className="material-symbols-outlined">delete_forever</span>{' '}
        {t('admin:user_group_management.delete_modal.header')}
      </ModalHeader>
      <ModalBody>
        <div>
          <span className="fw-bold">
            {t('admin:user_group_management.group_name')}
          </span>{' '}
          : &quot;{props?.deleteUserGroup?.name || ''}&quot;
        </div>
        <div className="text-danger mt-3">
          {t('admin:user_group_management.delete_modal.desc')}
        </div>
      </ModalBody>
      <ModalFooter>
        <form
          className="d-flex justify-content-between w-100"
          onSubmit={handleSubmit}
        >
          <div className="d-flex mb-0 me-3">
            {renderPageActionSelector()}
            {renderGroupSelector()}
          </div>
          <button
            type="submit"
            value=""
            className="btn btn-sm btn-danger text-nowrap"
            disabled={!validateForm()}
          >
            <span className="material-symbols-outlined">delete_forever</span>{' '}
            {t('Delete')}
          </button>
        </form>
        {actionName === PageActionOnGroupDelete.publicize && (
          <div className="form-text text-muted">
            <small>
              {t('admin:user_group_management.delete_modal.option_explanation')}
            </small>
          </div>
        )}
      </ModalFooter>
    </Modal>
  );
};
