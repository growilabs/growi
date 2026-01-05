import type { FC } from 'react';
import React, { useState } from 'react';
import type { IUser } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { Popover, PopoverBody, UncontrolledTooltip } from 'reactstrap';

import UserPictureList from '../Common/UserPictureList';

import styles from './SeenUserInfo.module.scss';
import popoverStyles from './user-list-popover.module.scss';

interface Props {
  seenUsers: IUser[];
  sumOfSeenUsers?: number;
  disabled?: boolean;
}

const SeenUserInfo: FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const { seenUsers, sumOfSeenUsers, disabled } = props;

  const togglePopover = () => setIsPopoverOpen(!isPopoverOpen);

  return (
    <div className={`grw-seen-user-info ${styles['grw-seen-user-info']}`}>
      <button
        type="button"
        id="btn-seen-user"
        className="shadow-none btn btn-seen-user border-0 d-flex align-items-center"
      >
        <span className="material-symbols-outlined me-1">footprint</span>
        <span className="total-counts">
          {sumOfSeenUsers || seenUsers.length}
        </span>
      </button>
      <Popover
        placement="bottom"
        isOpen={isPopoverOpen}
        target="btn-seen-user"
        toggle={togglePopover}
        trigger="legacy"
        disabled={disabled}
      >
        <PopoverBody
          className={`user-list-popover ${popoverStyles['user-list-popover']}`}
        >
          <div className="px-2 text-end user-list-content text-truncate text-muted">
            <UserPictureList users={seenUsers} />
          </div>
        </PopoverBody>
      </Popover>
      <UncontrolledTooltip
        data-testid="seen-user-info-tooltip"
        target="btn-seen-user"
        fade={false}
      >
        {t('tooltip.footprints')}
      </UncontrolledTooltip>
    </div>
  );
};

export default SeenUserInfo;
