import type { JSX, RefObject } from 'react';
import { useTranslation } from 'next-i18next';
import { Popover, PopoverBody, PopoverHeader } from 'reactstrap';

import type { ReactionUser } from '../../../interfaces';

import styles from './CommentReactionBar.module.scss';

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
  readonly isOpen: boolean;
  readonly toggle: () => void;
  readonly users: readonly ReactionUser[];
};

export const ReactionUsersPopover = ({
  target,
  isOpen,
  toggle,
  users,
}: ReactionUsersPopoverProps): JSX.Element => {
  const { t } = useTranslation();

  return (
    <Popover
      target={target}
      isOpen={isOpen}
      toggle={toggle}
      trigger="legacy"
      placement="bottom"
    >
      <PopoverHeader>{t('comment_reaction.reacted_by')}</PopoverHeader>
      <PopoverBody>
        <ul className={styles['reaction-users-list']}>
          {users.map((user) => (
            <li key={toKey(user)}>{toDisplayName(user)}</li>
          ))}
        </ul>
      </PopoverBody>
    </Popover>
  );
};
