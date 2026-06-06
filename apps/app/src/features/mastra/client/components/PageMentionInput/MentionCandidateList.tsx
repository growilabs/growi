import { useEffect, useRef } from 'react';
import { UserPicture } from '@growi/ui/dist/components';
import Downshift from 'downshift';
import { useTranslation } from 'react-i18next';
import SimpleBar from 'simplebar-react';

import { cn } from '~/utils/shadcn-ui';

import type { MentionController, PagePathCandidate } from './types';

interface MentionCandidateListProps {
  readonly controller: MentionController;
}

/**
 * Pure presentational candidate dropdown for the `@` mention session.
 *
 * It owns NO search and NO session logic: every value it renders
 * (`isOpen`/`query`/`candidates`/`isLoading`/`highlightedIndex`) is read from the
 * `MentionController`, and every action delegates back to the controller.
 *
 * Keyboard navigation lives in the CodeMirror keymap (the editor owns focus), so
 * `downshift` is used here as a CONTROLLED rendering helper only: it provides the
 * combobox/listbox ARIA wiring, mouse-hover highlighting (synced back via
 * `setHighlightedIndex`), click selection, and automatic scroll-into-view of the
 * highlighted item. The `highlightedIndex`/`isOpen` it renders are driven by the
 * controller; downshift never owns that state.
 *
 * Positioning: anchored above the input box (`bottom-full` inside
 * PageMentionInput's `relative` wrapper) — the standard chat mention placement.
 */
export const MentionCandidateList = ({
  controller,
}: MentionCandidateListProps): JSX.Element | null => {
  const { t } = useTranslation();

  const { isOpen, query, candidates, isLoading, highlightedIndex } = controller;

  const panelRef = useRef<HTMLDivElement>(null);
  // Points to the currently highlighted row so it can be scrolled into view.
  const highlightedItemRef = useRef<HTMLDivElement | null>(null);

  // Keep the highlighted candidate visible on keyboard navigation. downshift's
  // own scroll-into-view targets the getMenuProps element, which is NOT the
  // scroll container here (SimpleBar's content-wrapper is), so it has no effect.
  // We scroll the highlighted row's nearest scrollable ancestor (the SimpleBar
  // wrapper) instead. downshift's internal scroll is disabled below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the highlighted index changes
  useEffect(() => {
    highlightedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // Pointer dismissal (2.4): a mousedown outside the panel closes the session.
  // Esc is handled by the keymap (task 4.2); this only handles the pointer path.
  // A row click is a target inside the panel, so it never triggers this branch
  // before the click selection runs.
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
      data-slot="mention-candidate-list"
      className={cn(
        'tw:absolute tw:bottom-full tw:left-0 tw:z-50 tw:mb-2 tw:w-full tw:max-w-md tw:overflow-hidden',
        // Lighter frame: faint border + softer shadow.
        'tw:rounded-md tw:border tw:border-border/50 tw:bg-popover tw:text-popover-foreground tw:shadow-sm',
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
        <Downshift<PagePathCandidate>
          isOpen
          highlightedIndex={highlightedIndex}
          selectedItem={null}
          itemToString={(item) => item?.path ?? ''}
          // Disable downshift's internal scroll-into-view: it scrolls the
          // getMenuProps element, but the real scroll container is SimpleBar's
          // wrapper. Scroll-follow is handled by the effect above instead.
          scrollIntoView={() => {}}
          onSelect={(item) => {
            if (item == null) {
              return;
            }
            const index = candidates.findIndex((c) => c.pageId === item.pageId);
            if (index >= 0) {
              controller.commit(index);
            }
          }}
          onStateChange={(changes) => {
            // Mouse hover moves downshift's highlight; sync it back so keyboard
            // and pointer share a single highlight (owned by the controller).
            if (typeof changes.highlightedIndex === 'number') {
              controller.setHighlightedIndex(changes.highlightedIndex);
            }
          }}
        >
          {({ getRootProps, getMenuProps, getItemProps }) => (
            <div {...getRootProps({}, { suppressRefError: true })}>
              <SimpleBar style={{ maxHeight: '18rem' }} className="tw:p-1">
                <div {...getMenuProps()}>
                  {candidates.map((c, index) => {
                    const highlighted = index === highlightedIndex;
                    return (
                      <div
                        key={c.pageId}
                        {...getItemProps({ item: c, index })}
                        ref={highlighted ? highlightedItemRef : null}
                        role="option"
                        aria-selected={highlighted}
                        // tabIndex -1: focus stays in the editor (keyboard nav is
                        // delegated to the CodeMirror keymap); allows programmatic
                        // focus and satisfies the focusable-interactive a11y rule.
                        tabIndex={-1}
                        // Keyboard parity for assistive tech that activates a
                        // focused option directly; primary nav remains the keymap.
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            controller.commit(index);
                          }
                        }}
                        className={cn(
                          'tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-sm tw:px-2 tw:py-1.5 tw:text-sm',
                          // Lighter path color; highlighted row keeps stronger contrast.
                          highlighted
                            ? 'tw:bg-accent tw:text-accent-foreground'
                            : 'tw:text-muted-foreground',
                        )}
                      >
                        {/* Page creator avatar (no link/tooltip inside the dropdown). */}
                        <UserPicture
                          user={c.creator}
                          size="sm"
                          noLink
                          noTooltip
                        />
                        <span className="tw:truncate">{c.path}</span>
                      </div>
                    );
                  })}
                </div>
              </SimpleBar>
            </div>
          )}
        </Downshift>
      )}
    </div>
  );
};
