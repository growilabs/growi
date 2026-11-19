import type { JSX, RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Popover, PopoverBody, PopoverHeader } from 'reactstrap';

import type { ReactionUser } from '../../../interfaces';
import { toReactionUserDisplayName } from '../../utils/to-reaction-user-display-name';

import styles from './CommentReactionBar.module.scss';

// Long enough to cross the gap between the chip and the popover, so a long list can be scrolled.
const DELAY = { show: 0, hide: 200 };

const toKey = (user: ReactionUser): string =>
  typeof user === 'string' ? user : user._id;

/** Whether a toggle request is the target losing its focus to the popover itself. */
const isFocusMovingInto = (
  event: unknown,
  popover: HTMLElement | null,
): boolean =>
  event instanceof FocusEvent &&
  event.type === 'focusout' &&
  event.relatedTarget instanceof Node &&
  popover?.contains(event.relatedTarget) === true;

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
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // The focus trigger closes as soon as the target loses focus. A press inside the popover
  // moves the focus there (it is focusable so its text can be selected), which must not close it.
  const toggle = useCallback((event?: unknown) => {
    if (isFocusMovingInto(event, popoverRef.current)) {
      return;
    }
    setIsOpen((open) => !open);
  }, []);

  return (
    <Popover
      target={target}
      isOpen={isOpen}
      toggle={toggle}
      trigger="hover focus"
      placement="bottom"
      delay={DELAY}
      fade={false}
      innerRef={popoverRef}
      tabIndex={-1}
    >
      <PopoverHeader>{t('comment_reaction.reacted_by')}</PopoverHeader>
      <PopoverBody>
        <ul className={styles['reaction-users-list']}>
          {users.map((user) => (
            <li key={toKey(user)}>{toReactionUserDisplayName(user)}</li>
          ))}
        </ul>
      </PopoverBody>
    </Popover>
  );
};
