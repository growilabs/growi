/**
 * Combines the hit-test hook with the content-preview popover and decides,
 * on every render, which comment id (if any) should have its popover open.
 *
 * `useHighlightHitTest` reports only the *current* hit and doesn't latch a
 * click-selected id itself — once the pointer leaves the highlight after a
 * click, the next pointermove clears the hook's value back to `null`. This
 * component owns "pinning" a click-opened popover despite that: `pinnedId`
 * persists across the hook clearing its hit, and is cleared only by the
 * popover's own close mechanism, never merely because a hover hit stopped
 * being reported. While pinned, a hover elsewhere does nothing; a new click
 * always redirects the pin.
 *
 * A hover-sourced hit is only promoted into `hoverPreviewId` after it has
 * been the current hit continuously for `HOVER_SHOW_DELAY_MS`, and survives
 * the hit clearing for `HOVER_HIDE_DELAY_MS` — this is what lets the pointer
 * travel from the highlight to the (DOM-disjoint, portaled) popover without
 * it disappearing mid-transit. `handlePointerEnterPopover` cancels that
 * grace timer once the pointer actually arrives and promotes
 * `hoverPreviewId` into `pinnedId`, so from then on it behaves like a
 * click-pinned popover.
 */
import {
  type FC,
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { RendererOptions } from '~/interfaces/renderer-options';

import type {
  InlineCommentWithReplies,
  ResolvedRange,
} from '../../../interfaces';
import { rangesById } from '../../services/resolved-range';
import { InlineCommentPreviewPopover } from './InlineCommentPreviewPopover';
import type { HighlightHit } from './use-highlight-hit-test';
import { useHighlightHitTest } from './use-highlight-hit-test';

type InlineCommentBodyInteractionProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  resolvedRanges: ReadonlyMap<string, ResolvedRange>;
  inlineComments: InlineCommentWithReplies[];
  createReply: (parentId: string, comment: string) => Promise<unknown>;
  /** Toggles a comment's resolved state; forwarded as-is to `InlineCommentPreviewPopover`. */
  resolve: (id: string, resolved: boolean) => Promise<unknown>;
  /** Persists an edited origin-comment body; forwarded as-is to `InlineCommentPreviewPopover`. */
  update: (id: string, comment: string) => Promise<unknown>;
  /** Deletes an origin comment with its whole thread; forwarded as-is to `InlineCommentPreviewPopover`. */
  remove: (id: string) => Promise<unknown>;
  /** Persists an edited reply body; forwarded as-is to `InlineCommentPreviewPopover`. */
  updateReply: (id: string, comment: string) => Promise<unknown>;
  /** Deletes a single reply; forwarded as-is to `InlineCommentPreviewPopover`. */
  removeReply: (id: string) => Promise<unknown>;
  /** Undefined while renderer options are still loading; the popover falls back to plain text. */
  rendererOptions: RendererOptions | undefined;
};

const EMPTY_RANGES: ReadonlyMap<string, Range> = new Map();

// Short delays tuned for re-confirming an already-familiar highlight, not a first-time tooltip.
const HOVER_SHOW_DELAY_MS = 150;
const HOVER_HIDE_DELAY_MS = 250;

export const InlineCommentBodyInteraction: FC<
  InlineCommentBodyInteractionProps
> = (props): JSX.Element | null => {
  const {
    containerRef,
    resolvedRanges,
    inlineComments,
    createReply,
    resolve,
    update,
    remove,
    updateReply,
    removeReply,
    rendererOptions,
  } = props;

  // Rebuilt on every render from the container's current DOM, never cached —
  // same policy as resolved-range.ts. Serves both the hit-test hook and the
  // popover lookup below.
  const container = containerRef.current;
  const ranges: ReadonlyMap<string, Range> =
    container != null ? rangesById(container, resolvedRanges) : EMPTY_RANGES;

  const hit = useHighlightHitTest(containerRef, ranges);

  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoverPreviewId, setHoverPreviewId] = useState<string | null>(null);
  // The hit value showing when the popover's own close last fired. Needed
  // because closing doesn't itself change what useHighlightHitTest reports:
  // its close button is portaled outside containerRef's subtree, so the
  // click that triggers it is invisible to the hook, and the hit would
  // otherwise stay unchanged and reopen the popover on the next render.
  const [suppressedHit, setSuppressedHit] = useState<HighlightHit | null>(null);

  // Refs, not state: starting/cancelling a timer doesn't itself affect rendered output.
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A click hit pins the popover open on that id and lifts any prior
  // suppression. Hover hits are intentionally not observed here.
  useEffect(() => {
    if (hit?.source === 'click') {
      setPinnedId(hit.commentId);
      setHoverPreviewId(null);
      setSuppressedHit(null);
    }
  }, [hit]);

  const isHitSuppressed =
    suppressedHit != null &&
    hit != null &&
    suppressedHit.commentId === hit.commentId &&
    suppressedHit.source === hit.source;
  const effectiveHit = isHitSuppressed ? null : hit;

  // Debounced show/hide for hover-sourced hits. While pinned, hover hits are
  // ignored outright. The cleanup clears both timers on every re-run and on
  // unmount, so no timer ever fires against a stale hit.
  useEffect(() => {
    if (pinnedId != null) {
      return undefined;
    }

    if (effectiveHit?.source === 'hover') {
      // Reaching the highlight again always cancels a pending hide.
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      if (hoverPreviewId !== effectiveHit.commentId) {
        if (showTimerRef.current != null) {
          clearTimeout(showTimerRef.current);
        }
        showTimerRef.current = setTimeout(() => {
          setHoverPreviewId(effectiveHit.commentId);
          showTimerRef.current = null;
        }, HOVER_SHOW_DELAY_MS);
      }
    } else {
      // Hit cleared: a hover hit that hasn't survived its show delay must not
      // appear at all; something already shown gets a hide grace period first.
      if (showTimerRef.current != null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }

      if (hoverPreviewId != null) {
        hideTimerRef.current = setTimeout(() => {
          setHoverPreviewId(null);
          hideTimerRef.current = null;
        }, HOVER_HIDE_DELAY_MS);
      }
    }

    return () => {
      if (showTimerRef.current != null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (hideTimerRef.current != null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [effectiveHit, pinnedId, hoverPreviewId]);

  // Called once the popover reports the pointer has entered its own DOM.
  // Cancels the pending hide and promotes the hover-shown id into pinnedId;
  // a no-op if a click already pinned a popover in the meantime.
  const handlePointerEnterPopover = useCallback((): void => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (pinnedId != null) {
      return;
    }

    setPinnedId(hoverPreviewId);
    setHoverPreviewId(null);
  }, [pinnedId, hoverPreviewId]);

  const handleClose = (): void => {
    setPinnedId(null);
    setHoverPreviewId(null);
    setSuppressedHit(hit);
  };

  // Once the pinned/preview id stops resolving in inlineComments (resolved
  // and filtered out upstream, or deleted), the internal state must clear it,
  // not just render nothing — otherwise a later hover hit on a different
  // highlight would still be ignored while pinnedId stays non-null.
  useEffect(() => {
    const currentId = pinnedId ?? hoverPreviewId;
    if (currentId == null) {
      return;
    }

    const stillExists = inlineComments.some(
      (candidate) => candidate.id === currentId,
    );
    if (stillExists) {
      return;
    }

    if (pinnedId != null) {
      setPinnedId(null);
    }
    if (hoverPreviewId != null) {
      setHoverPreviewId(null);
    }
  }, [inlineComments, pinnedId, hoverPreviewId]);

  const displayedId = pinnedId ?? hoverPreviewId ?? null;

  const comment =
    displayedId != null
      ? inlineComments.find((candidate) => candidate.id === displayedId)
      : undefined;
  // Should always resolve (hit ids come from `ranges`, itself built from
  // resolvedRanges), but the comments list can momentarily lag during a
  // refetch, so this stays a defensive guard.
  const range = displayedId != null ? ranges.get(displayedId) : undefined;

  if (comment == null || range == null) {
    return null;
  }

  return (
    <InlineCommentPreviewPopover
      comment={comment}
      range={range}
      rendererOptions={rendererOptions}
      createReply={createReply}
      resolve={resolve}
      update={update}
      remove={remove}
      updateReply={updateReply}
      removeReply={removeReply}
      onClose={handleClose}
      onPointerEnter={handlePointerEnterPopover}
    />
  );
};
