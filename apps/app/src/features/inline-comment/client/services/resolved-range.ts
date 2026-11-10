import type { ResolvedRange } from '../../interfaces';
import { type RenderedText, renderedTextOf } from './rendered-text';

/**
 * Reconstructs a DOM `Range` from a single resolved anchor, or `null` when the
 * anchor could not be resolved (`not_found`) or when the resolved offsets no
 * longer map to a DOM position (e.g. the container's content has since changed).
 */
export const rangeForResolved = (
  renderedText: RenderedText,
  resolved: ResolvedRange,
): Range | null => {
  if (resolved.status === 'not_found') {
    return null;
  }

  const start = renderedText.resolveDomPosition(resolved.startOffset);
  const end = renderedText.resolveDomPosition(resolved.endOffset, 'end');
  if (start == null || end == null) {
    return null;
  }

  const range = new Range();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

/**
 * Reconstructs a `Range` for every resolvable entry in `resolvedRanges`, keyed by
 * the same comment id. Entries whose resolution is `not_found` (or otherwise fail
 * to resolve to a DOM position) are omitted from the result.
 *
 * `Range` objects are never cached — they are rebuilt from `container`'s current
 * DOM on every call, consistent with the rest of this feature's design.
 */
export const rangesById = (
  container: HTMLElement,
  resolvedRanges: ReadonlyMap<string, ResolvedRange>,
): ReadonlyMap<string, Range> => {
  const renderedText = renderedTextOf(container);
  const next = new Map<string, Range>();
  for (const [id, resolved] of resolvedRanges) {
    const range = rangeForResolved(renderedText, resolved);
    if (range != null) {
      next.set(id, range);
    }
  }
  return next;
};

/**
 * The Range a comment saved from `selection` will be restored to after a
 * reload. Only text offsets are saved, so an image at either edge of the
 * selection is not part of it; painting the pending highlight with this
 * Range keeps it identical to the saved one.
 */
export const savedRangeOf = (
  container: HTMLElement,
  selection: Range,
): Range | null => {
  const renderedText = renderedTextOf(container);
  return rangeForResolved(renderedText, {
    status: 'exact',
    startOffset: renderedText.textOffsetOf(
      selection.startContainer,
      selection.startOffset,
    ),
    endOffset: renderedText.textOffsetOf(
      selection.endContainer,
      selection.endOffset,
    ),
  });
};
