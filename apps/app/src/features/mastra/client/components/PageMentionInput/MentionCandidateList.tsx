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
 * (`isOpen`/`query`/`candidates`/`isLoading`/`highlightedIndex`/`coords`) is read
 * from the `MentionController`, and every action (commit/close) delegates back to
 * the controller. The 4-state display rule below mirrors the design table
 * (1.1/1.2/1.4/2.1/2.5/2.6).
 */
export const MentionCandidateList = ({
  controller,
}: MentionCandidateListProps): JSX.Element | null => {
  const { t } = useTranslation();

  const { isOpen, query, candidates, isLoading, highlightedIndex, coords } =
    controller;

  const panelRef = useRef<HTMLDivElement>(null);

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

  // Anchor the panel below the caret. Coords may be null in headless/early
  // states; fall back to the top-left of the positioning context.
  const style: React.CSSProperties = {
    left: coords?.left ?? 0,
    top: coords?.bottom ?? 0,
  };

  return (
    <div
      ref={panelRef}
      role="listbox"
      data-slot="mention-candidate-list"
      style={style}
      className={cn(
        'tw:absolute tw:z-50 tw:min-w-64 tw:max-w-md tw:overflow-hidden',
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
