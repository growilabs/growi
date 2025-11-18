import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';

import type { IUserGroupHasId } from '@growi/core';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

type Props = {
  userGroup: IUserGroupHasId,
  parentUserGroup?: IUserGroupHasId,
  selectableParentUserGroups?: IUserGroupHasId[],
  submitButtonLabel: string;
  onSubmit: (targetGroup: IUserGroupHasId, userGroupData: Partial<IUserGroupHasId>) => Promise<void>
  isExternalGroup?: boolean
};

export const UserGroupForm: FC<Props> = (props: Props) => {

  const { t } = useTranslation('admin');

  const {
    userGroup, parentUserGroup, selectableParentUserGroups, submitButtonLabel, onSubmit, isExternalGroup = false,
  } = props;
  /*
   * State
   */
  const [currentName, setName] = useState<string>(userGroup.name);
  const [currentDescription, setDescription] = useState<string>(userGroup.description);
  const [selectedParent, setSelectedParent] = useState<IUserGroupHasId | undefined>();
  /*
   * Function
   */
  const onChangeNameHandler = useCallback((e) => {
    setName(e.target.value);
  }, []);

  const onChangeDescriptionHandler = useCallback((e) => {
    setDescription(e.target.value);
  }, []);

  const onChangeParentButtonHandler = useCallback((userGroup: IUserGroupHasId) => {
    if (userGroup._id !== selectedParent?._id) {
      setSelectedParent(userGroup);
    }
  }, [selectedParent, setSelectedParent]);

  useEffect(() => {
    setSelectedParent(parentUserGroup);
  }, [parentUserGroup]);

  const isSelectableParentUserGroups = selectableParentUserGroups != null && selectableParentUserGroups.length > 0;

  const isChildUserGroup = parentUserGroup !== undefined;
  const messageAtReleaseParentGroup = isChildUserGroup ? t('user_group_management.release_parent_group') : t('user_group_management.select_parent_group');

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      onSubmit(props.userGroup, {
        name: currentName,
        description: currentDescription,
        parent: selectedParent,
      });
    }}
    >

      <fieldset>
        <h2 className="admin-setting-header">{t('user_group_management.basic_info')}</h2>
        {isExternalGroup
        && (
          <div className="mb-3">
            <small className="text-muted">{t('external_user_group.only_description_edit_allowed')}</small>
          </div>
        )}
        {
          userGroup?.createdAt != null && (
            <div className="row mb-3">
              <p className="col-md-2 col-form-label">{t('Created')}</p>
              <p className="col-md-6 my-auto">{dateFnsFormat(userGroup.createdAt, 'yyyy-MM-dd')}</p>
            </div>
          )
        }

        <div className="row mb-3">
          <label htmlFor="name" className="col-md-2 col-form-label">
            {t('user_group_management.group_name')}
          </label>
          <div className="col-md-6 my-auto">
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
        </div>

        <div className="row mb-3">
          <label htmlFor="description" className="col-md-2 col-form-label">
            {t('Description')}
          </label>
          <div className="col-md-6">
            <textarea className="form-control" name="description" value={currentDescription} onChange={onChangeDescriptionHandler} />
          </div>
        </div>

        <div className="row mb-3">
          <label htmlFor="parent" className="col-md-2 col-form-label">
            {t('user_group_management.parent_group')}
          </label>
          <div className="dropdown col-md-6">
            <button
              type="button"
              id="dropdownMenuButton"
              data-bs-toggle="dropdown"
              className="btn btn-outline-secondary dropdown-toggle mb-3"
              disabled={isExternalGroup || !isSelectableParentUserGroups}
            >
              {selectedParent?.name ?? messageAtReleaseParentGroup}
            </button>
            <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
              {
                isSelectableParentUserGroups && (
                  <>
                    {
                      selectableParentUserGroups.map(userGroup => (
                        <button
                          key={userGroup._id}
                          type="button"
                          className={`dropdown-item ${selectedParent?._id === userGroup._id ? 'active' : ''}`}
                          onClick={() => onChangeParentButtonHandler(userGroup)}
                        >
                          {userGroup.name}
                        </button>
                      ))
                    }
                  </>
                )
              }

              <div className="dropdown-divider" />

              <button
                className="dropdown-item"
                type="button"
                onClick={() => { setSelectedParent(undefined) }}
              >{t('user_group_management.release_parent_group')}
              </button>
            </div>
          </div>
        </div>

        <div className="row mb-5">
          <div className="offset-md-2 col-md-10">
            <button type="submit" className="btn btn-primary">
              {submitButtonLabel}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
};
