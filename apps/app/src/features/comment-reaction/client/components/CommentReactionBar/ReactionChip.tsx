import type { JSX } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';

import type {
  ReactionChip as ReactionChipType,
  ReactionKey,
} from '../../../interfaces';
import { resolveReactionGlyph, tryParseReactionKey } from '../../../utils';
import { ReactionUsersPopover } from './ReactionUsersPopover';

import styles from './CommentReactionBar.module.scss';

type ReactionChipProps = {
  readonly chip: ReactionChipType;
  readonly canReact: boolean;
  /** Disables the emoji part while a write is in flight; the count part stays pressable. */
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
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  // A ref target: useId() output contains colons, which reactstrap cannot resolve as a selector.
  const countRef = useRef<HTMLButtonElement>(null);

  const { emoji, count, reactedByMe, users } = chip;
  // A persisted key can be malformed or outlive the emoji data; never let it break the render.
  const parsed = tryParseReactionKey(emoji);
  const shortcode = parsed?.shortcode ?? emoji;
  const emojiLabel =
    parsed?.skinTone == null
      ? shortcode
      : `${shortcode} skin-tone-${parsed.skinTone}`;
  const glyph = resolveReactionGlyph(emoji) ?? `:${shortcode}:`;

  const toggleReaction = useCallback(() => {
    onToggle(emoji, !reactedByMe);
  }, [emoji, onToggle, reactedByMe]);

  const toggleUsers = useCallback(() => {
    setIsUsersOpen((isOpen) => !isOpen);
  }, []);

  const frameClassName = [
    styles['reaction-chip'],
    reactedByMe ? styles['reaction-chip-mine'] : '',
  ]
    .filter((name) => name !== '')
    .join(' ');

  return (
    <span className={frameClassName}>
      {canReact ? (
        <button
          type="button"
          className={styles['reaction-chip-emoji']}
          aria-pressed={reactedByMe}
          aria-label={emojiLabel}
          disabled={isUpdating}
          onClick={toggleReaction}
        >
          {glyph}
        </button>
      ) : (
        <span className={styles['reaction-chip-emoji']}>{glyph}</span>
      )}
      <button
        type="button"
        ref={countRef}
        className={styles['reaction-chip-count']}
        aria-label={t('comment_reaction.reacted_count', { count })}
        aria-haspopup="dialog"
        aria-expanded={isUsersOpen}
      >
        {count}
      </button>
      <ReactionUsersPopover
        target={countRef}
        isOpen={isUsersOpen}
        toggle={toggleUsers}
        users={users}
      />
    </span>
  );
};
