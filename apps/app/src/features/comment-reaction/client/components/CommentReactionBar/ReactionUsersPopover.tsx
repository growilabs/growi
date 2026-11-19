import type { JSX, RefObject } from 'react';
import { useTranslation } from 'next-i18next';
import { PopoverBody, PopoverHeader, UncontrolledPopover } from 'reactstrap';

import type { ReactionUser } from '../../../interfaces';

import styles from './CommentReactionBar.module.scss';

// Long enough to cross the gap between the chip and the popover, so a long list can be scrolled.
const DELAY = { show: 0, hide: 200 };

const toDisplayName = (user: ReactionUser): string => {
  if (typeof user === 'string') {
    return user;
  }
  return user.name != null && user.name !== '' ? user.name : user.username;
};

const toKey = (user: ReactionUser): string =>
  typeof user === 'string' ? user : user._id;

type ReactionUsersPopoverProps = {
  readonly target: RefObject<HTMLElement>;
  readonly users: readonly ReactionUser[];
};

/** Lists who reacted while the target is hovered or has focus. */
export const ReactionUsersPopover = ({
  target,
  users,
}: ReactionUsersPopoverProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <UncontrolledPopover
      target={target}
      trigger="hover focus"
      placement="bottom"
      delay={DELAY}
      fade={false}
    >
      <PopoverHeader>{t('comment_reaction.reacted_by')}</PopoverHeader>
      <PopoverBody>
        <ul className={styles['reaction-users-list']}>
          {users.map((user) => (
            <li key={toKey(user)}>{toDisplayName(user)}</li>
          ))}
        </ul>
      </PopoverBody>
    </UncontrolledPopover>
  );
};
