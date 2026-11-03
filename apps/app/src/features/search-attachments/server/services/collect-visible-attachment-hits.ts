/**
 * Pages through the attachment hits that the viewer may see for
 * facet=attachments, without letting hidden hits shape the answer.
 *
 * The attachments index has no permission data, so hits are fetched in a
 * growing window (score order) and gated afterwards. What is returned is
 * defined on the stream of visible hits only: its shortest prefix that
 * reaches `from + size` distinct pages and holds at least
 * `ceil((from + size) * OVER_FETCH_MULTIPLIER)` hits (or the whole stream when
 * it is shorter). As long as the window stays under WINDOW_CAP hits, the
 * result is exactly what it would be if no hidden hit existed; past the cap,
 * visible hits ranked below WINDOW_CAP hidden-or-visible hits are not
 * reachable.
 *
 * The loop is bounded on its own, whatever the caller passes: pagination that
 * asks for nothing (or is not a non-negative integer) searches nothing, an
 * empty slice ends the stream, and at most MAX_ROUNDS slices are requested.
 * An aborted `signal` stops it before the next search.
 */

import type { AttachmentEsHit } from './attachment-search-result-aggregator';

export const OVER_FETCH_MULTIPLIER = 1.5;
export const WINDOW_CAP = 200;
/** Windows double from at least 2 hits up to WINDOW_CAP. */
export const MAX_ROUNDS = Math.ceil(Math.log2(WINDOW_CAP)) + 1;

export type CollectVisibleAttachmentHitsDeps = {
  /** One slice of the attachment hits in score order. */
  searchHits: (from: number, size: number) => Promise<AttachmentEsHit[]>;
  /** The ids (among pageIds) the viewer may see; throws on failure. */
  findVisiblePageIds: (pageIds: string[]) => Promise<Set<string>>;
};

export type VisibleAttachmentPage = {
  readonly pageId: string;
  readonly hits: AttachmentEsHit[];
};

const visiblePrefixLength = (
  visibleHits: AttachmentEsHit[],
  pagesNeeded: number,
  minHits: number,
): number | null => {
  const seen = new Set<string>();
  for (const [i, hit] of visibleHits.entries()) {
    seen.add(hit._source.pageId);
    if (seen.size >= pagesNeeded) {
      const length = Math.max(i + 1, minHits);
      return visibleHits.length >= length ? length : null;
    }
  }
  return null;
};

const groupByPage = (hits: AttachmentEsHit[]): VisibleAttachmentPage[] => {
  const byPage = new Map<string, AttachmentEsHit[]>();
  for (const hit of hits) {
    const pageId = hit._source.pageId;
    byPage.set(pageId, [...(byPage.get(pageId) ?? []), hit]);
  }
  return [...byPage].map(([pageId, pageHits]) => ({ pageId, hits: pageHits }));
};

export const collectVisibleAttachmentHits = async (
  { searchHits, findVisiblePageIds }: CollectVisibleAttachmentHitsDeps,
  { from, size, signal }: { from: number; size: number; signal?: AbortSignal },
): Promise<VisibleAttachmentPage[]> => {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(size) ||
    from < 0 ||
    size <= 0
  ) {
    return [];
  }
  const pagesNeeded = from + size;
  const minHits = Math.ceil(pagesNeeded * OVER_FETCH_MULTIPLIER);
  const visibility = new Map<string, boolean>();
  const fetched: AttachmentEsHit[] = [];
  let windowSize = Math.min(minHits, WINDOW_CAP);

  for (let round = 1; ; round++) {
    signal?.throwIfAborted();
    const requested = windowSize - fetched.length;
    // biome-ignore lint/performance/noAwaitInLoops: each window depends on the previous one
    const chunk = await searchHits(fetched.length, requested);
    signal?.throwIfAborted();
    // A backend that answers more than asked must not grow the window
    fetched.push(...chunk.slice(0, requested));

    const undecided = [...new Set(fetched.map((h) => h._source.pageId))].filter(
      (id) => !visibility.has(id),
    );
    if (undecided.length > 0) {
      const visible = await findVisiblePageIds(undecided);
      signal?.throwIfAborted();
      for (const id of undecided) {
        visibility.set(id, visible.has(id));
      }
    }

    const visibleHits = fetched.filter(
      (h) => visibility.get(h._source.pageId) === true,
    );
    const prefix = visiblePrefixLength(visibleHits, pagesNeeded, minHits);
    const exhausted =
      chunk.length === 0 ||
      chunk.length < requested ||
      windowSize >= WINDOW_CAP ||
      round >= MAX_ROUNDS;
    if (prefix != null || exhausted) {
      const kept = visibleHits.slice(0, prefix ?? visibleHits.length);
      return groupByPage(kept).slice(from, pagesNeeded);
    }
    windowSize = Math.min(windowSize * 2, WINDOW_CAP);
  }
};
