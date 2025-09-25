import type { FC } from 'react';
import React, { useCallback } from 'react';

import type { IUserGroupHasId } from '@growi/core';
import { useTranslation } from 'next-i18next';

type Props = {
  selectableUserGroups?: IUserGroupHasId[]
  onClickAddExistingUserGroupButton?(userGroup: IUserGroupHasId | null): void
  onClickCreateUserGroupButton?(): void
};

export const UserGroupDropdown: FC<Props> = (props: Props) => {
  const { t } = useTranslation();

  const { selectableUserGroups, onClickAddExistingUserGroupButton, onClickCreateUserGroupButton } = props;

  const onClickAddExistingUserGroupButtonHandler = useCallback((userGroup: IUserGroupHasId) => {
    if (onClickAddExistingUserGroupButton != null) {
      onClickAddExistingUserGroupButton(userGroup);
    }
  }, [onClickAddExistingUserGroupButton]);

  const onClickCreateUserGroupButtonHandler = useCallback(() => {
    if (onClickCreateUserGroupButton != null) {
      onClickCreateUserGroupButton();
    }
  }, [onClickCreateUserGroupButton]);

  return (
    <>
      <div className="dropdown">
        <button className="btn btn-secondary dropdown-toggle" type="button" id="dropdownMenuButton" data-bs-toggle="dropdown">
          {t('admin:user_group_management.add_child_group')}
        </button>

        <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">

          {
            (selectableUserGroups != null && selectableUserGroups.length > 0) && (
              <>
                {
                  selectableUserGroups.map(userGroup => (
                    <button
                      key={userGroup._id}
                      type="button"
                      className="dropdown-item"
                      onClick={() => onClickAddExistingUserGroupButtonHandler(userGroup)}
                    >
                      {userGroup.name}
                    </button>
                  ))
                }
                <div className="dropdown-divider"></div>
              </>
            )
          }

          <button
            className="dropdown-item"
            type="button"
            onClick={() => onClickCreateUserGroupButtonHandler()}
          >{t('admin:user_group_management.create_group')}
          </button>
        </div>
      </div>
    </>
  );
};
