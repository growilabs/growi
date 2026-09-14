import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { isDeepEquals } from '@growi/core/dist/utils/is-deep-equals';

import type { InlineCommentAnchor, ResolvedRange } from '../../../interfaces';
import {
  matchQuote,
  type QuoteMatchResult,
} from '../../services/quote-matcher';
import { renderedTextOf } from '../../services/rendered-text';
import {
  hasRenderingElements,
  useContainerSettle,
} from './use-container-settle';

/** One origin comment's identity plus the anchor `matchQuote` searches for. */
export interface AnchorResolverInput {
  id: string;
  anchor: InlineCommentAnchor;
}

const toResolvedRange = (result: QuoteMatchResult): ResolvedRange => {
  if (
    result.status === 'not_found' ||
    result.startOffset == null ||
    result.endOffset == null
  ) {
    return { status: 'not_found' };
  }
  return {
    status: result.status,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
  };
};

const resolveAll = (
  container: HTMLElement | null,
  anchors: ReadonlyArray<AnchorResolverInput>,
): ReadonlyMap<string, ResolvedRange> => {
  if (container == null) {
    return new Map();
  }

  const renderedText = renderedTextOf(container);
  const next = new Map<string, ResolvedRange>();
  for (const { id, anchor } of anchors) {
    next.set(id, toResolvedRange(matchQuote(renderedText.text, anchor)));
  }
  return next;
};

/**
 * Returns a value that keeps its previous identity across renders as long as
 * `value`'s content is deep-equal to the previous render's, and only takes on
 * a new identity when the content genuinely changed.
 *
 * `anchors` comes from `useSWRxInlineComments`, which hands back a new array
 * reference on every revalidation even when the underlying comment list is
 * unchanged. Depending on `anchors` itself in a `useEffect` would therefore
 * re-run the effect (and re-`setResolved`, a new `Map` each time) on every
 * revalidation tick forever. Comparing content and reusing the previous
 * reference when it matches turns that into a dependency that only changes
 * when there is something new to recompute against.
 */
const useStableByContent = <T extends object>(value: T): T => {
  const ref = useRef(value);
  if (!isDeepEquals(ref.current, value)) {
    ref.current = value;
  }
  return ref.current;
};

/**
 * Resolves every origin comment's anchor against the currently rendered page
 * text, keyed by comment id.
 *
 * Recomputation has two independent triggers. `useContainerSettle` alone is
 * not enough: a plain markdown page settles exactly once, at mount, before
 * `useSWRxInlineComments`'s list fetch resolves, so `anchors` is still `[]`
 * at that point and the container never settles again. Without a second
 * trigger, anchors that arrive later would never get matched against the
 * DOM — so an effect also recomputes whenever `anchors`' own content changes,
 * not only its reference (see `useStableByContent` above), resolving only
 * while nothing is mid-render (`hasRenderingElements`).
 *
 * Recomputation itself is the same idempotent full-`Map` rebuild either way:
 * `renderedTextOf` runs once and `matchQuote` runs for each anchor,
 * producing a fresh `Map` that replaces the previous one — no persistent
 * cache, so every trigger recomputes from scratch.
 *
 * This hook only reads the DOM; it never writes to it. Highlight rendering
 * is `InlineCommentHighlight`'s separate responsibility.
 *
 * `anchors` is read fresh on every settle via the closure `useContainerSettle`
 * captures each render, so concurrent settle events just apply React's
 * normal "last `setState` wins" semantics — no extra lock is needed, and the
 * same applies between the settle callback and the anchors-content-change effect.
 */
export const useAnchorResolver = (
  containerRef: RefObject<HTMLElement | null>,
  anchors: ReadonlyArray<AnchorResolverInput>,
): ReadonlyMap<string, ResolvedRange> => {
  const [resolved, setResolved] = useState<ReadonlyMap<string, ResolvedRange>>(
    () => new Map(),
  );

  const stableAnchors = useStableByContent(anchors);

  useContainerSettle(containerRef, () => {
    setResolved(resolveAll(containerRef.current, stableAnchors));
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: containerRef is a stable ref object; only stableAnchors' identity should retrigger this.
  useEffect(() => {
    const container = containerRef.current;
    // The comment list can arrive while an asynchronously-rendered element
    // (KaTeX / Mermaid / PlantUML / draw.io) is still filling itself in.
    // Resolving now would match against a half-built DOM and publish a wrong
    // result, so skip and leave the recomputation to the settle signal above,
    // which fires once no rendering element is left.
    if (container != null && hasRenderingElements(container)) {
      return;
    }
    setResolved(resolveAll(container, stableAnchors));
  }, [stableAnchors]);

  return resolved;
};
