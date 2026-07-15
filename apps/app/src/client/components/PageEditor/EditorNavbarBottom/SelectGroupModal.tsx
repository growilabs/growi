import React, { type JSX, useCallback } from 'react';
import type { IUserHasId } from '@growi/core';
import { GroupType, getIdForRef, PageGrant } from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalHeader } from 'reactstrap';

import type {
  GroupGrantData,
  IPageSelectedGrant,
  UserRelatedGroupsData,
} from '~/interfaces/page';
import { UserGroupPageGrantStatus } from '~/interfaces/page';
import { useSWRxRelatedGroupsMembers } from '~/stores/user';

import { GroupMembersLabel } from './GroupMembersLabel';

type SelectGroupModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentUser: IUserHasId | undefined;
  selectedGrant: IPageSelectedGrant | null;
  setSelectedGrant: (grant: IPageSelectedGrant) => void;
  groupGrantData: GroupGrantData | undefined;
};

export const SelectGroupModal = ({
  isOpen,
  onClose,
  currentUser,
  selectedGrant,
  setSelectedGrant,
  groupGrantData,
}: SelectGroupModalProps): JSX.Element => {
  const { t } = useTranslation();
  const { data: membersByGroupId } = useSWRxRelatedGroupsMembers(isOpen);

  const groupListItemClickHandler = useCallback(
    (clickedGroup: UserRelatedGroupsData) => {
      const userRelatedGrantedGroups =
        selectedGrant?.userRelatedGrantedGroups ?? [];
      let updated = [...userRelatedGrantedGroups];
      if (
        updated.find((group) => getIdForRef(group.item) === clickedGroup.id) ==
        null
      ) {
        updated.push({ item: clickedGroup.id, type: clickedGroup.type });
      } else {
        updated = updated.filter(
          (group) => getIdForRef(group.item) !== clickedGroup.id,
        );
      }
      setSelectedGrant({
        grant: PageGrant.GRANT_USER_GROUP,
        userRelatedGrantedGroups: updated,
      });
    },
    [setSelectedGrant, selectedGrant?.userRelatedGrantedGroups],
  );

  const renderBody = useCallback(() => {
    if (!isOpen) return <></>;

    if (groupGrantData == null) {
      return (
        <div className="my-3 text-center">
          <LoadingSpinner className="mx-auto text-muted fs-4" />
        </div>
      );
    }

    const { userRelatedGroups, nonUserRelatedGrantedGroups } = groupGrantData;

    if (userRelatedGroups.length === 0) {
      return (
        <div>
          <h4>{t('user_group.belonging_to_no_group')}</h4>
          {currentUser?.admin && (
            <p>
              <a href="/admin/user-groups">
                <span className="material-symbols-outlined me-1">login</span>
                {t('user_group.manage_user_groups')}
              </a>
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="d-flex flex-column">
        {userRelatedGroups.map((group) => {
          const isGroupGranted = selectedGrant?.userRelatedGrantedGroups?.some(
            (grantedGroup) => getIdForRef(grantedGroup.item) === group.id,
          );
          const cannotGrantGroup =
            group.status === UserGroupPageGrantStatus.cannotGrant;
          const activeClass = isGroupGranted ? 'active' : '';

          return (
            <button
              className={`btn btn-outline-primary d-flex justify-content-start mb-3 mx-4 align-items-center p-3 ${activeClass}`}
              type="button"
              key={group.id}
              onClick={() => groupListItemClickHandler(group)}
              disabled={cannotGrantGroup}
            >
              <input
                type="checkbox"
                checked={isGroupGranted}
                disabled={cannotGrantGroup}
              />
              <p className="ms-3 mb-0">{group.name}</p>
              {group.type === GroupType.externalUserGroup && (
                <span className="ms-2 badge badge-pill badge-info">
                  {group.provider}
                </span>
              )}
              <GroupMembersLabel
                members={membersByGroupId?.[group.id] ?? []}
                currentUsername={currentUser?.username}
              />
            </button>
          );
        })}
        {nonUserRelatedGrantedGroups.map((group) => (
          <button
            className="btn btn-outline-primary d-flex justify-content-start mb-3 mx-4 align-items-center p-3 active"
            type="button"
            key={group.id}
            disabled
          >
            <input type="checkbox" checked disabled />
            <p className="ms-3 mb-0">{group.name}</p>
            {group.type === GroupType.externalUserGroup && (
              <span className="ms-2 badge badge-pill badge-info">
                {group.provider}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-primary mt-2 mx-auto"
          onClick={onClose}
        >
          {t('Done')}
        </button>
      </div>
    );
  }, [
    currentUser,
    groupGrantData,
    groupListItemClickHandler,
    isOpen,
    membersByGroupId,
    onClose,
    selectedGrant?.userRelatedGrantedGroups,
    t,
  ]);

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered>
      <ModalHeader
        tag="p"
        toggle={onClose}
        className="fs-5 text-muted fw-bold pb-2"
        close={
          <button
            type="button"
            className="btn border-0 text-muted ms-auto"
            onClick={onClose}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        }
      >
        {t('user_group.select_group')}
      </ModalHeader>
      <ModalBody>{renderBody()}</ModalBody>
    </Modal>
  );
};
