import type { JSX } from 'react';
import { useCallback, useRef, useState } from 'react';
import {
  EmojiPicker,
  type EmojiPickerSelection,
} from '@growi/editor/dist/client/components/EmojiPicker';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import { useNextThemes } from '~/stores-universal/use-next-themes';

import type { ReactionKey } from '../../../interfaces';
import { MAX_REACTION_KINDS_PER_COMMENT } from '../../../interfaces';
import { fromPickerSelection } from '../../../utils';

import styles from './CommentReactionBar.module.scss';

type AddReactionButtonProps = {
  readonly canReact: boolean;
  /** Number of distinct reactions the comment already has. */
  readonly chipCount: number;
  /** Disables the button while a write is in flight. */
  readonly isUpdating?: boolean;
  readonly onAdd: (emoji: ReactionKey) => void;
};

export const AddReactionButton = ({
  canReact,
  chipCount,
  isUpdating = false,
  onAdd,
}: AddReactionButtonProps): JSX.Element | null => {
  const { t } = useTranslation();
  const { resolvedTheme } = useNextThemes();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // A ref target: useId() output contains colons, which reactstrap cannot resolve as a selector.
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const openPicker = useCallback(() => {
    setIsPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setIsPickerOpen(false);
  }, []);

  const handleSelect = useCallback(
    (selection: EmojiPickerSelection) => {
      setIsPickerOpen(false);
      const key = fromPickerSelection(selection);
      if (!key.ok) {
        return;
      }
      onAdd(key.value);
    },
    [onAdd],
  );

  if (!canReact) {
    return null;
  }

  const isLimitReached = chipCount >= MAX_REACTION_KINDS_PER_COMMENT;

  return (
    <>
      {/* A disabled button emits no mouse events, so the tooltip hangs off its wrapper. */}
      <span ref={wrapperRef} className={styles['add-reaction']}>
        <button
          type="button"
          className={styles['add-reaction-button']}
          aria-label={t('comment_reaction.add_reaction')}
          aria-haspopup="dialog"
          disabled={isLimitReached || isUpdating}
          onClick={openPicker}
        >
          +
        </button>
      </span>
      {isLimitReached && (
        <UncontrolledTooltip target={wrapperRef} placement="top">
          {t('comment_reaction.kind_limit_reached')}
        </UncontrolledTooltip>
      )}
      <EmojiPicker
        isOpen={isPickerOpen}
        onSelect={handleSelect}
        onClose={closePicker}
        theme={resolvedTheme}
      />
    </>
  );
};
