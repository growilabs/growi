import React, { type JSX, useRef } from 'react';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import type { IUserGroupMember } from '~/interfaces/user-group-member';

type GroupMembersLabelProps = {
  members: IUserGroupMember[];
  currentUsername: string | undefined;
};

export const GroupMembersLabel = ({
  members,
  currentUsername,
}: GroupMembersLabelProps): JSX.Element | null => {
  const { t } = useTranslation();
  const labelRef = useRef<HTMLElement>(null);

  if (members.length === 0) return null;

  const onlySelf = members.every((m) => m.username === currentUsername);
  if (onlySelf) {
    return (
      <small className="ms-2 text-muted">{t('user_group.only_yourself')}</small>
    );
  }
  const label = members.map((m) => m.name || m.username).join(', ');
  return (
    <>
      <small
        ref={labelRef}
        className="ms-2 text-muted text-truncate"
        style={{ minWidth: 0 }}
      >
        {label}
      </small>
      <UncontrolledTooltip target={labelRef}>{label}</UncontrolledTooltip>
    </>
  );
};
