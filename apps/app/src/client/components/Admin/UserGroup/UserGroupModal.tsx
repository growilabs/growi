import type { FC } from 'react';
import React, {
  useState, useEffect, useCallback, useMemo,
} from 'react';

import type { Ref, IUserGroup, IUserGroupHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';

type Props = {
  userGroup?: IUserGroupHasId,
  buttonLabel?: string,
  onClickSubmit?: (userGroupData: Partial<IUserGroupHasId>) => Promise<IUserGroupHasId | void>
  isShow?: boolean
  onHide?: () => Promise<void> | void
  isExternalGroup?: boolean
};

const UserGroupModalSubstance: FC<Props> = (props: Props) => {

  const { t } = useTranslation('admin');

  const {
    userGroup, buttonLabel, onClickSubmit, onHide, isExternalGroup = false,
  } = props;

  /*
   * State
   */
  const [currentName, setName] = useState('');
  const [currentDescription, setDescription] = useState('');
  const [currentParent, setParent] = useState<Ref<IUserGroup> | null>(null);

  /*
   * Function
   */
  const onChangeNameHandler = useCallback((e) => {
    setName(e.target.value);
  }, []);

  const onChangeDescriptionHandler = useCallback((e) => {
    setDescription(e.target.value);
  }, []);

  // Memoized user group data for submission
  const userGroupData = useMemo(() => ({
    _id: userGroup?._id,
    name: currentName,
    description: currentDescription,
    parent: currentParent,
  }), [userGroup?._id, currentName, currentDescription, currentParent]);

  const onSubmitHandler = useCallback(async(e) => {
    e.preventDefault(); // no reload

    if (onClickSubmit == null) {
      return;
    }

    await onClickSubmit(userGroupData);
  }, [onClickSubmit, userGroupData]);

  // componentDidMount
  useEffect(() => {
    if (userGroup != null) {
      setName(userGroup.name);
      setDescription(userGroup.description);
      setParent(userGroup.parent);
    }
  }, [userGroup]);

  return (
    <form onSubmit={onSubmitHandler}>
      <ModalHeader tag="h4" toggle={onHide}>
        {t('user_group_management.basic_info')}
      </ModalHeader>

      <ModalBody>
        <div>
          <label htmlFor="name" className="form-label">
            {t('user_group_management.group_name')}
          </label>
          <input
            className="form-control"
            type="text"
            name="name"
            placeholder={t('user_group_management.group_example')}
            value={currentName}
            onChange={onChangeNameHandler}
            required
            disabled={isExternalGroup}
          />
        </div>

        <div>
          <label htmlFor="description" className="form-label">
            {t('Description')}
          </label>
          <textarea className="form-control" name="description" value={currentDescription} onChange={onChangeDescriptionHandler} />
          {isExternalGroup && (
            <p className="form-text text-muted">
              <small>
                {t('external_user_group.description_form_detail')}
              </small>
            </p>
          )}
        </div>

        {/* TODO 90732: Add a drop-down to show selectable parents */}

        {/* TODO 85462: Add a note that "if you change the parent, the offspring will also be moved together */}

      </ModalBody>

      <ModalFooter>
        <div>
          <button type="submit" className="btn btn-primary">
            {buttonLabel}
          </button>
        </div>
      </ModalFooter>
    </form>
  );
};

export const UserGroupModal: FC<Props> = (props: Props) => {
  const { isShow, onHide } = props;

  return (
    <Modal className="modal-md" isOpen={isShow} toggle={onHide}>
      {isShow && (
        <UserGroupModalSubstance {...props} />
      )}
    </Modal>
  );
};
