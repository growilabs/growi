import type { AttachmentEsHit } from './attachment-search-result-aggregator';
import {
  type CollectVisibleAttachmentHitsDeps,
  collectVisibleAttachmentHits,
  MAX_ROUNDS,
  WINDOW_CAP,
} from './collect-visible-attachment-hits';

// A runaway loop would starve the event loop, so the fakes stop it themselves.
const RUNAWAY_GUARD = 50;

const hitOn = (pageId: string, n: number): AttachmentEsHit => ({
  _id: `${pageId}-${n}`,
  _score: 1,
  _source: {
    attachmentId: `att-${pageId}-${n}`,
    pageId,
    fileName: 'a.pdf',
    originalName: 'a.pdf',
    fileFormat: 'pdf',
    fileSize: 1,
    pageNumber: null,
    label: null,
  },
});

/**
 * An index holding `stream` in score order; `visible` are the pages the
 * viewer may see. Records every slice requested.
 */
const fakeIndex = (
  stream: readonly AttachmentEsHit[],
  visible: ReadonlySet<string>,
  slice: (from: number, size: number) => AttachmentEsHit[] = (from, size) =>
    stream.slice(from, from + size),
) => {
  const calls: Array<{ from: number; size: number }> = [];
  const deps: CollectVisibleAttachmentHitsDeps = {
    searchHits: async (from, size) => {
      calls.push({ from, size });
      if (calls.length > RUNAWAY_GUARD) {
        throw new Error('runaway: searchHits called too many times');
      }
      return slice(from, size);
    },
    findVisiblePageIds: async (pageIds) =>
      new Set(pageIds.filter((id) => visible.has(id))),
  };
  return { deps, calls };
};

const hiddenStream = (count: number): AttachmentEsHit[] =>
  Array.from({ length: count }, (_, i) => hitOn(`hidden-${i}`, 0));

describe('collectVisibleAttachmentHits', () => {
  describe('pagination that asks for nothing or is not a valid number', () => {
    it.each([
      { from: 0, size: 0 },
      { from: 0, size: -5 },
      { from: -1, size: 10 },
      { from: Number.NaN, size: 10 },
      { from: 0, size: Number.NaN },
      { from: 0, size: 1.5 },
      { from: Number.POSITIVE_INFINITY, size: 10 },
    ])('returns no pages without searching for from=$from size=$size', async (paging) => {
      const { deps, calls } = fakeIndex(
        [hitOn('p1', 0)],
        new Set(['p1']),
        () => [],
      );

      await expect(collectVisibleAttachmentHits(deps, paging)).resolves.toEqual(
        [],
      );
      expect(calls).toEqual([]);
    });
  });

  describe('when the index runs out of hits', () => {
    it('stops at the first empty slice', async () => {
      const { deps, calls } = fakeIndex([], new Set());

      await expect(
        collectVisibleAttachmentHits(deps, { from: 0, size: 10 }),
      ).resolves.toEqual([]);
      expect(calls).toHaveLength(1);
    });

    it('stops at an empty slice even when the index ignores the requested size', async () => {
      // A backend that answers every slice after the first with nothing
      const stream = hiddenStream(500);
      const { deps, calls } = fakeIndex(stream, new Set(), (from) =>
        from === 0 ? stream.slice(0, 1000) : [],
      );

      await collectVisibleAttachmentHits(deps, { from: 0, size: 10 });

      expect(calls.length).toBeLessThanOrEqual(2);
    });

    it('asks once more after a window that ends exactly at the end of the stream', async () => {
      // size 2 -> windows of 3 then 6 hits; 6 hidden hits fill both exactly
      const { deps, calls } = fakeIndex(hiddenStream(6), new Set());

      await expect(
        collectVisibleAttachmentHits(deps, { from: 0, size: 2 }),
      ).resolves.toEqual([]);
      expect(calls).toEqual([
        { from: 0, size: 3 },
        { from: 3, size: 3 },
        { from: 6, size: 6 },
      ]);
    });
  });

  describe('the number of rounds', () => {
    it('never exceeds MAX_ROUNDS while every hit stays hidden', async () => {
      const { deps, calls } = fakeIndex(hiddenStream(10_000), new Set());

      await collectVisibleAttachmentHits(deps, { from: 0, size: 1 });

      expect(calls.length).toBeLessThanOrEqual(MAX_ROUNDS);
      const lastWindowEnd =
        (calls.at(-1)?.from ?? 0) + (calls.at(-1)?.size ?? 0);
      expect(lastWindowEnd).toBe(WINDOW_CAP);
    });

    it('never exceeds MAX_ROUNDS when the index returns more hits than asked', async () => {
      const stream = hiddenStream(10_000);
      const { deps, calls } = fakeIndex(stream, new Set(), (from, size) =>
        stream.slice(from, from + size * 3),
      );

      await collectVisibleAttachmentHits(deps, { from: 0, size: 150 });

      expect(calls.length).toBeLessThanOrEqual(MAX_ROUNDS);
    });
  });

  describe('cancellation', () => {
    it('does not search when the signal is already aborted', async () => {
      const { deps, calls } = fakeIndex(hiddenStream(100), new Set());
      const controller = new AbortController();
      controller.abort();

      await expect(
        collectVisibleAttachmentHits(deps, {
          from: 0,
          size: 1,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it('stops after the round in flight when the signal is aborted', async () => {
      const controller = new AbortController();
      const index = fakeIndex(hiddenStream(10_000), new Set());
      const deps: CollectVisibleAttachmentHitsDeps = {
        ...index.deps,
        searchHits: async (from, size) => {
          const hits = await index.deps.searchHits(from, size);
          if (index.calls.length === 2) controller.abort();
          return hits;
        },
      };

      await expect(
        collectVisibleAttachmentHits(deps, {
          from: 0,
          size: 1,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(index.calls).toHaveLength(2);
    });
  });

  it('still returns the visible pages in score order', async () => {
    const stream = [
      hitOn('hidden', 0),
      hitOn('p1', 0),
      hitOn('p2', 0),
      hitOn('p1', 1),
    ];
    const { deps } = fakeIndex(stream, new Set(['p1', 'p2']));

    const pages = await collectVisibleAttachmentHits(deps, {
      from: 0,
      size: 2,
    });

    expect(pages.map((p) => p.pageId)).toEqual(['p1', 'p2']);
    expect(pages[0].hits.map((h) => h._id)).toEqual(['p1-0', 'p1-1']);
  });
});
