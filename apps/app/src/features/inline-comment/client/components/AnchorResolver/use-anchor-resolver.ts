import type { RefObject } from 'react';
import { useState } from 'react';

import type { InlineCommentAnchor, ResolvedRange } from '../../../interfaces';
import {
  matchQuote,
  type QuoteMatchResult,
} from '../../services/quote-matcher';
import { renderedTextOf } from '../../services/rendered-text';
import { useContainerSettle } from './use-container-settle';

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

/**
 * Resolves every origin comment's anchor against the currently rendered page
 * text, keyed by comment id (design.md: AnchorResolver > State Management).
 *
 * Recomputation is driven entirely by `useContainerSettle`: every time the
 * container settles, `renderedTextOf` is called once and `matchQuote` is run
 * for each anchor, producing a fresh `Map` that replaces the previous one.
 * There is no persistent cache — design.md's "解決済みオフセットキャッシュを
 * 持たない判断" explicitly rejects one, so every settle recomputes from
 * scratch and the result is thrown away and rebuilt, not patched in place.
 *
 * This hook only reads the DOM; it never writes to it. Highlight rendering
 * is `InlineCommentHighlight`'s separate responsibility.
 *
 * `anchors` is read fresh on every settle via the closure `useContainerSettle`
 * captures each render (it re-points its internal ref without re-subscribing
 * the observer) — so no extra memoization or locking is needed here either;
 * concurrent settle events just apply React's normal "last `setState` wins"
 * semantics, per design.md's explicit call-out that no extra lock is added.
 */
export const useAnchorResolver = (
  containerRef: RefObject<HTMLElement | null>,
  anchors: ReadonlyArray<AnchorResolverInput>,
): ReadonlyMap<string, ResolvedRange> => {
  const [resolved, setResolved] = useState<ReadonlyMap<string, ResolvedRange>>(
    () => new Map(),
  );

  useContainerSettle(containerRef, () => {
    const container = containerRef.current;
    if (container == null) {
      setResolved(new Map());
      return;
    }

    const renderedText = renderedTextOf(container);
    const next = new Map<string, ResolvedRange>();
    for (const { id, anchor } of anchors) {
      next.set(id, toResolvedRange(matchQuote(renderedText.text, anchor)));
    }
    setResolved(next);
  });

  return resolved;
};
