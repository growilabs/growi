import type { JSX } from 'react';
import { useCallback, useId, useRef } from 'react';
import { useTranslation } from 'next-i18next';

import type {
  ReactionChip as ReactionChipType,
  ReactionKey,
} from '../../../interfaces';
import { resolveReactionGlyph, tryParseReactionKey } from '../../../utils';
import { useCanHover } from '../../hooks/use-can-hover';
import { toReactionUserDisplayName } from '../../utils/to-reaction-user-display-name';
import { ReactionUsersPopover } from './ReactionUsersPopover';

import styles from './CommentReactionBar.module.scss';

type ReactionChipProps = {
  readonly chip: ReactionChipType;
  readonly canReact: boolean;
  /** Blocks the toggle while a write is in flight; who reacted stays viewable. */
  readonly isUpdating?: boolean;
  readonly onToggle: (emoji: ReactionKey, isReacted: boolean) => void;
};

export const ReactionChip = ({
  chip,
  canReact,
  isUpdating = false,
  onToggle,
}: ReactionChipProps): JSX.Element => {
  const { t } = useTranslation();
  const canHover = useCanHover();
  // A ref target: useId() output contains colons, which reactstrap cannot resolve as a selector.
  const chipRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();

  const { emoji, count, reactedByMe, users } = chip;
  // A persisted key can be malformed or outlive the emoji data; never let it break the render.
  const parsed = tryParseReactionKey(emoji);
  const shortcode = parsed?.shortcode ?? emoji;
  const emojiLabel =
    parsed?.skinTone == null
      ? shortcode
      : `${shortcode} skin-tone-${parsed.skinTone}`;
  const glyph = resolveReactionGlyph(emoji) ?? `:${shortcode}:`;

  // The popover is portaled and unmounted while closed, so a screen reader cannot reach it;
  // the names ride on the chip's description instead, under the same condition the popover shows.
  const countDescription = t('comment_reaction.reacted_count', { count });
  const description = canHover
    ? `${countDescription}: ${users.map(toReactionUserDisplayName).join(', ')}`
    : countDescription;

  // aria-disabled rather than disabled: a disabled button gets no hover, which shows who reacted.
  const isToggleBlocked = !canReact || isUpdating;

  const toggleReaction = useCallback(() => {
    if (isToggleBlocked) {
      return;
    }
    onToggle(emoji, !reactedByMe);
  }, [emoji, isToggleBlocked, onToggle, reactedByMe]);

  const className = [
    styles['reaction-chip'],
    reactedByMe ? styles['reaction-chip-mine'] : '',
  ]
    .filter((name) => name !== '')
    .join(' ');

  return (
    <>
      <button
        type="button"
        ref={chipRef}
        className={className}
        aria-pressed={reactedByMe}
        aria-label={emojiLabel}
        aria-describedby={descriptionId}
        aria-disabled={isToggleBlocked || undefined}
        aria-busy={isUpdating || undefined}
        onClick={toggleReaction}
      >
        <span className={styles['reaction-chip-emoji']}>{glyph}</span>
        <span className={styles['reaction-chip-count']}>{count}</span>
        <span id={descriptionId} className="visually-hidden">
          {description}
        </span>
      </button>
      {canHover && <ReactionUsersPopover target={chipRef} users={users} />}
    </>
  );
};
