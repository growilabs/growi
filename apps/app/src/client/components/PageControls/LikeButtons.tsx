import type { FC } from 'react';
import React, { useCallback, useState } from 'react';
import type { IUser } from '@growi/core';
import { useTranslation } from 'next-i18next';
import { Popover, PopoverBody, UncontrolledTooltip } from 'reactstrap';

import UserPictureList from '../Common/UserPictureList';

import styles from './LikeButtons.module.scss';
import popoverStyles from './user-list-popover.module.scss';

type LikeButtonsProps = {
  sumOfLikers: number;
  likers: IUser[];

  isGuestUser?: boolean;
  isLiked?: boolean;
  onLikeClicked?: () => void;
};

const LikeButtons: FC<LikeButtonsProps> = (props: LikeButtonsProps) => {
  const { t } = useTranslation();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const togglePopover = () => {
    setIsPopoverOpen(!isPopoverOpen);
  };

  const { isGuestUser, isLiked, sumOfLikers, onLikeClicked } = props;

  const getTooltipMessage = useCallback(() => {
    if (isLiked) {
      return 'tooltip.cancel_like';
    }
    return 'tooltip.like';
  }, [isLiked]);

  return (
    <fieldset
      className={`btn-group btn-group-like ${styles['btn-group-like']}`}
      aria-label="Like buttons"
    >
      <button
        type="button"
        id="like-button"
        onClick={onLikeClicked}
        className={`btn btn-like
            ${isLiked ? 'active' : ''} ${isGuestUser ? 'disabled' : ''}`}
      >
        <span className={`material-symbols-outlined ${isLiked ? 'fill' : ''}`}>
          favorite
        </span>
      </button>

      <UncontrolledTooltip
        data-testid="like-button-tooltip"
        target="like-button"
        autohide={false}
        fade={false}
      >
        {t(getTooltipMessage())}
      </UncontrolledTooltip>

      <button
        type="button"
        id="po-total-likes"
        className={`btn btn-like
          total-counts ${isLiked ? 'active' : ''}`}
      >
        {sumOfLikers}
      </button>
      <Popover
        placement="bottom"
        isOpen={isPopoverOpen}
        target="po-total-likes"
        toggle={togglePopover}
        trigger="legacy"
      >
        <PopoverBody
          className={`user-list-popover ${popoverStyles['user-list-popover']}`}
        >
          <div className="px-2 text-end user-list-content text-truncate text-muted">
            {props.likers?.length ? (
              <UserPictureList users={props.likers} />
            ) : (
              t('No users have liked this yet.')
            )}
          </div>
        </PopoverBody>
      </Popover>
    </fieldset>
  );
};

export default LikeButtons;
