import type { JSX, MouseEvent, RefObject } from 'react';
import { useTranslation } from 'next-i18next';
import { PopoverBody, PopoverHeader, UncontrolledPopover } from 'reactstrap';

import type { ReactionUser } from '../../../interfaces';
import { toReactionUserDisplayName } from '../../utils/to-reaction-user-display-name';

import styles from './CommentReactionBar.module.scss';

// Long enough to cross the gap between the chip and the popover, so a long list can be scrolled.
const DELAY = { show: 0, hide: 200 };

const toKey = (user: ReactionUser): string =>
  typeof user === 'string' ? user : user._id;

// The focus trigger hides on the target's focusout with no delay, and a press on the
// non-focusable list would blur the target; keep focus there so a click inside does not close it.
const keepTargetFocus = (e: MouseEvent<HTMLElement>): void => {
  e.preventDefault();
};

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
      onMouseDown={keepTargetFocus}
    >
      <PopoverHeader>{t('comment_reaction.reacted_by')}</PopoverHeader>
      <PopoverBody>
        <ul className={styles['reaction-users-list']}>
          {users.map((user) => (
            <li key={toKey(user)}>{toReactionUserDisplayName(user)}</li>
          ))}
        </ul>
      </PopoverBody>
    </UncontrolledPopover>
  );
};
