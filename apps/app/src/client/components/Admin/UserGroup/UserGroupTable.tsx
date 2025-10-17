import type { FC, JSX } from 'react';
import React, { useState, useEffect } from 'react';

import type { IUserGroupHasId, IUserGroupRelation, IUserHasId } from '@growi/core';
import { format as dateFnsFormat } from 'date-fns/format';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';

import type { IExternalUserGroupHasId } from '~/features/external-user-group/interfaces/external-user-group';


import styles from './UserGroupTable.module.scss';

const userGroupEditLinkStyle = styles['user-group-edit-link'] ?? '';


type Props = {
  headerLabel?: string,
  userGroups: IUserGroupHasId[],
  userGroupRelations: IUserGroupRelation[],
  childUserGroups: IUserGroupHasId[],
  isAclEnabled: boolean,
  onEdit?: (userGroup: IUserGroupHasId) => void | Promise<void>,
  onRemove?: (userGroup: IUserGroupHasId) => void | Promise<void>,
  onDelete?: (userGroup: IUserGroupHasId) => void | Promise<void>,
  isExternalGroup?: boolean
};

/*
 * Utility
 */
const generateGroupIdToUsersMap = (userGroupRelations: IUserGroupRelation[]): Record<string, Partial<IUserHasId>[]> => {
  const userGroupMap = {};
  userGroupRelations.forEach((relation) => {
    const group = relation.relatedGroup as string; // must be an id of related group

    const users: Partial<IUserHasId>[] = userGroupMap[group] || [];
    users.push(relation.relatedUser as IUserHasId);

    // register
    userGroupMap[group] = users;
  });

  return userGroupMap;
};

const generateGroupIdToChildGroupsMap = (childUserGroups: IUserGroupHasId[]): Record<string, IUserGroupHasId[]> => {
  const map = {};
  childUserGroups.forEach((group) => {
    const parentId = group.parent as string; // must be an id

    const groups: Partial<IUserGroupHasId>[] = map[parentId] || [];
    groups.push(group);

    // register
    map[parentId] = groups;
  });

  return map;
};

type UserGroupEditLinkProps = {
  group:IUserGroupHasId,
  isExternalGroup:boolean,
}

const UserGroupEditLink = (props: UserGroupEditLinkProps): JSX.Element => {
  return (
    <Link
      href={`/admin/user-group-detail/${props.group._id}?isExternalGroup=${props.isExternalGroup}`}
      className={`${userGroupEditLinkStyle} link-secondary link-offset-2 link-underline-opacity-25 link-underline-opacity-100-hover`}
    >
      <span className="material-symbols-outlined pe-2 pt-2">group</span>
      <span>{props.group.name}</span>
      <span className="grw-edit-icon material-symbols-outlined px-2 py-0">edit</span>
    </Link>
  );
};

export const UserGroupTable: FC<Props> = ({
  headerLabel,
  userGroups,
  userGroupRelations,
  childUserGroups,
  isAclEnabled,
  onEdit,
  onRemove,
  onDelete,
  isExternalGroup = false,
}: Props) => {
  const { t } = useTranslation('admin');

  /*
   * State
   */
  const [groupIdToUsersMap, setGroupIdToUsersMap] = useState(generateGroupIdToUsersMap(userGroupRelations));
  const [groupIdToChildGroupsMap, setGroupIdToChildGroupsMap] = useState(generateGroupIdToChildGroupsMap(childUserGroups));

  /*
   * Function
   */
  const findUserGroup = (e: React.ChangeEvent<HTMLInputElement>): IUserGroupHasId | undefined => {
    const groupId = e.target.getAttribute('data-user-group-id');
    return userGroups.find((group) => {
      return group._id === groupId;
    });
  };

  const onClickEdit = async(e) => {
    if (onEdit == null) {
      return;
    }

    const userGroup = findUserGroup(e);
    if (userGroup == null) {
      return;
    }

    onEdit(userGroup);
  };

  const onClickRemove = async(e) => {
    if (onRemove == null) {
      return;
    }

    const userGroup = findUserGroup(e);
    if (userGroup == null) {
      return;
    }

    try {
      await onRemove(userGroup);
      userGroup.parent = null;
    }
    catch {
      //
    }
  };

  const onClickDelete = (e) => { // no preventDefault
    if (onDelete == null) {
      return;
    }

    const userGroup = findUserGroup(e);
    if (userGroup == null) {
      return;
    }

    onDelete(userGroup);
  };

  /*
   * useEffect
   */
  useEffect(() => {
    setGroupIdToUsersMap(generateGroupIdToUsersMap(userGroupRelations));
    setGroupIdToChildGroupsMap(generateGroupIdToChildGroupsMap(childUserGroups));
  }, [userGroupRelations, childUserGroups]);

  return (
    <div data-testid="grw-user-group-table" className="mb-5">
      <h3>{headerLabel}</h3>

      <table className="table table-bordered table-user-list">
        <thead>
          <tr>
            {isExternalGroup && <th>{t('external_user_group.provider')}</th>}
            <th>{t('Name')}</th>
            <th>{t('Description')}</th>
            <th>{t('User')}</th>
            <th>{t('user_group_management.child_user_group')}</th>
            <th style={{ width: 100 }}>{t('Created')}</th>
            <th style={{ width: 70 }}></th>
          </tr>
        </thead>
        <tbody>
          {userGroups.map((group) => {
            const users = groupIdToUsersMap[group._id];

            return (
              <tr key={group._id}>
                {isExternalGroup && <td>{(group as IExternalUserGroupHasId).provider}</td>}
                {isAclEnabled
                  ? (
                    <td>
                      <UserGroupEditLink group={group} isExternalGroup={isExternalGroup} />
                    </td>
                  )
                  : (
                    <td>{group.name}</td>
                  )
                }
                <td>{group.description}</td>
                <td>
                  <ul className="list-inline">
                    {users != null && users.map((user) => {
                      return <li key={user._id} className="list-inline-item badge text-bg-warning">{user.username}</li>;
                    })}
                  </ul>
                </td>
                <td>
                  <ul className="list-inline">
                    {groupIdToChildGroupsMap[group._id] != null && groupIdToChildGroupsMap[group._id].map((group) => {
                      return (
                        <li key={group._id} className="list-inline-item badge text-bg-success">
                          {isAclEnabled
                            ? (
                              <Link href={`/admin/user-group-detail/${group._id}?isExternalGroup=${isExternalGroup}`}>{group.name}</Link>
                            )
                            : (
                              <p>{group.name}</p>
                            )
                          }
                        </li>
                      );
                    })}
                  </ul>
                </td>
                <td>{dateFnsFormat(group.createdAt, 'yyyy-MM-dd')}</td>
                {isAclEnabled
                  ? (
                    <td>
                      <div className="btn-group admin-group-menu">
                        <button
                          type="button"
                          id={`admin-group-menu-button-${group._id}`}
                          className="btn btn-outline-secondary btn-sm dropdown-toggle"
                          data-bs-toggle="dropdown"
                        >
                          <span className="material-symbols-outlined fs-5">settings</span>
                        </button>
                        <div className="dropdown-menu" role="menu" aria-labelledby={`admin-group-menu-button-${group._id}`}>
                          <button className="dropdown-item" type="button" role="button" onClick={onClickEdit} data-user-group-id={group._id}>
                            <span className="material-symbols-outlined me-1">edit_square</span> {t('Edit')}
                          </button>
                          {onRemove != null
                          && (
                            <button className="dropdown-item" type="button" role="button" onClick={onClickRemove} data-user-group-id={group._id}>
                              <span className="material-symbols-outlined me-1">group_remove</span> {t('admin:user_group_management.remove_child_group')}
                            </button>
                          )}
                          <button className="dropdown-item" type="button" role="button" onClick={onClickDelete} data-user-group-id={group._id}>
                            <span className="material-symbols-outlined text-danger">delete_forever</span> {t('Delete')}
                          </button>
                        </div>
                      </div>
                    </td>
                  )
                  : (
                    <td></td>
                  )
                }
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
