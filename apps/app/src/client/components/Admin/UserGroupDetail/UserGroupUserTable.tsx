import React, { type JSX } from 'react';

import { UserPicture } from '@growi/ui/dist/components';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';

import type { IUserGroupRelationHasIdPopulatedUser } from '~/interfaces/user-group-response';

type Props = {
  userGroupRelations: IUserGroupRelationHasIdPopulatedUser[] | undefined,
  onClickRemoveUserBtn: (username: string) => Promise<void>,
  onClickPlusBtn: () => void,
  isExternalGroup?: boolean
}

export const UserGroupUserTable = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  return (
    <table className="table table-bordered table-user-list mb-5">
      <thead>
        <tr>
          <th style={{ width: '100px' }}>#</th>
          <th>
            {t('username')}
          </th>
          <th>{t('Name')}</th>
          <th style={{ width: '100px' }}>{t('Created')}</th>
          <th style={{ width: '160px' }}>{t('last_login')}</th>
          {!props.isExternalGroup && <th style={{ width: '70px' }}></th>}
        </tr>
      </thead>
      <tbody>
        {props.userGroupRelations != null && props.userGroupRelations.map((relation) => {
          const { relatedUser } = relation;

          return (
            <tr key={relation._id}>
              <td>
                <UserPicture user={relatedUser} />
              </td>
              <td>
                <strong>{relatedUser.username}</strong>
              </td>
              <td>{relatedUser.name}</td>
              <td>{relatedUser.createdAt ? dateFnsFormat(relatedUser.createdAt, 'yyyy-MM-dd') : ''}</td>
              <td>{relatedUser.lastLoginAt ? dateFnsFormat(relatedUser.lastLoginAt, 'yyyy-MM-dd HH:mm:ss') : ''}</td>
              {!props.isExternalGroup && (
                <td>
                  <div className="btn-group admin-user-menu">
                    <button
                      type="button"
                      id={`admin-group-menu-button-${relatedUser._id}`}
                      className="btn btn-outline-secondary btn-sm dropdown-toggle"
                      data-bs-toggle="dropdown"
                    >
                      <span className="material-symbols-outlined fs-5">settings</span>
                    </button>
                    <div className="dropdown-menu" role="menu" aria-labelledby={`admin-group-menu-button-${relatedUser._id}`}>
                      <button
                        className="dropdown-item"
                        type="button"
                        onClick={() => props.onClickRemoveUserBtn(relatedUser.username)}
                      >
                        <span className="material-symbols-outlined me-1">person_remove</span>{t('admin:user_group_management.remove_from_group')}
                      </button>
                    </div>
                  </div>
                </td>
              )}
            </tr>
          );
        })}

        {!props.isExternalGroup && (
          <tr>
            <td></td>
            <td className="text-center">
              <button className="btn btn-outline-secondary" type="button" onClick={props.onClickPlusBtn}>
                <span className="material-symbols-outlined">add</span>
              </button>
            </td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        )}

      </tbody>
    </table>
  );
};
