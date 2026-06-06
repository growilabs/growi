import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '~/utils/shadcn-ui';

import type { MentionController } from './types';

interface MentionCandidateListProps {
  readonly controller: MentionController;
}

/**
 * Pure presentational candidate dropdown for the `@` mention session.
 *
 * It owns NO search and NO session logic: every value it renders
 * (`isOpen`/`query`/`candidates`/`isLoading`/`highlightedIndex`) is read from the
 * `MentionController`, and every action (commit/close) delegates back to the
 * controller. The 4-state display rule below mirrors the design table
 * (1.1/1.2/1.4/2.1/2.5/2.6).
 *
 * Positioning: the panel is anchored to the input box (rendered directly ABOVE
 * it via `bottom-full` inside PageMentionInput's `relative` wrapper), not to the
 * caret pixel. This is the standard chat mention-picker placement and avoids the
 * fragile viewport-vs-container coordinate mismatch of `coordsAtPos`.
 */
export const MentionCandidateList = ({
  controller,
}: MentionCandidateListProps): JSX.Element | null => {
  const { t } = useTranslation();

  const { isOpen, query, candidates, isLoading, highlightedIndex } = controller;

  const panelRef = useRef<HTMLDivElement>(null);
  // Points to the currently highlighted row so it can be scrolled into view.
  const highlightedItemRef = useRef<HTMLDivElement | null>(null);

  // Keep the highlighted candidate visible: when the highlight moves past the
  // visible area of the scrollable list (Arrow key navigation, 2.2), scroll it
  // into view within the dropdown's own scroll container.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the highlighted index changes
  useEffect(() => {
    highlightedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // Pointer dismissal (2.4): a mousedown outside the panel closes the session.
  // Esc is handled by the keymap (task 4.2); this component only handles the
  // pointer path. A row click is a separate `mousedown` target inside the panel,
  // so it never triggers this branch before `commit` runs.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (
        panelRef.current != null &&
        target != null &&
        panelRef.current.contains(target)
      ) {
        return;
      }
      controller.close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, controller]);

  if (!isOpen) {
    return null;
  }

  const hasQuery = query.length >= 1;

  return (
    <div
      ref={panelRef}
      role="listbox"
      data-slot="mention-candidate-list"
      // Anchored above the input box (the parent is `relative`); opens upward so
      // it stays visible for a bottom-docked chat input.
      className={cn(
        'tw:absolute tw:bottom-full tw:left-0 tw:z-50 tw:mb-1 tw:w-full tw:max-w-md tw:overflow-hidden',
        'tw:rounded-md tw:border tw:bg-popover tw:text-popover-foreground tw:shadow-md',
      )}
    >
      {/* Empty query: hint only, never candidates and never a search (1.1/1.2). */}
      {!hasQuery && (
        <div className="tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
          {t('pageMention.hint')}
        </div>
      )}

      {hasQuery && isLoading && (
        <div className="tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
          {t('pageMention.searching')}
        </div>
      )}

      {hasQuery && !isLoading && candidates.length === 0 && (
        <div className="tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground">
          {t('pageMention.noResults')}
        </div>
      )}

      {hasQuery && !isLoading && candidates.length > 0 && (
        <div className="tw:max-h-72 tw:overflow-y-auto tw:p-1">
          {candidates.map((c, index) => {
            const highlighted = index === highlightedIndex;
            return (
              <div
                key={c.pageId}
                ref={highlighted ? highlightedItemRef : null}
                role="option"
                aria-selected={highlighted}
                // tabIndex -1: keeps the row out of the tab order (focus stays
                // in the editor; arrow-key navigation is delegated to the
                // CodeMirror keymap) while still allowing programmatic focus.
                tabIndex={-1}
                // Commit on click; runs as part of the same press inside the
                // panel, so outside-close never preempts it (2.3).
                onClick={() => controller.commit(index)}
                // Keyboard parity for assistive tech that activates a focused
                // option directly. Primary navigation remains the keymap (4.2).
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    controller.commit(index);
                  }
                }}
                className={cn(
                  'tw:flex tw:cursor-pointer tw:items-center tw:rounded-sm tw:px-2 tw:py-1.5 tw:text-sm',
                  highlighted
                    ? 'tw:bg-accent tw:text-accent-foreground'
                    : 'tw:text-foreground',
                )}
              >
                <span className="tw:truncate">{c.path}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
