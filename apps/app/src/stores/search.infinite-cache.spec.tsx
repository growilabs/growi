import type { IPageHasId } from '@growi/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import type { IFormattedSearchResult } from '~/interfaces/search';

import { mutateSearchInfiniteChunks, useSWRINFxSearch } from './search';

// Real SWR (not mocked): the contract under test is how many requests reach the
// server, which depends on SWR's per-page / combined cache bookkeeping.
const apiGetSpy = vi.hoisted(() => vi.fn());
vi.mock('~/client/util/apiv1-client', () => ({ apiGet: apiGetSpy }));

const CHUNK_SIZE = 2;

// A full chunk for the requested offset against a large total, so every load
// can continue. Page paths are derived from the offset so rows are traceable.
const respondWithChunk = (
  _endpoint: string,
  params: { offset: number },
): Promise<IFormattedSearchResult> =>
  Promise.resolve({
    data: Array.from({ length: CHUNK_SIZE }, (_, i) => {
      const n = params.offset + i;
      return { data: mock<IPageHasId>({ _id: `p${n}`, path: `/page${n}` }) };
    }),
    meta: { total: 100, took: 1, hitsCount: CHUNK_SIZE },
  });

const requestedOffsets = (): number[] =>
  apiGetSpy.mock.calls.map(([, params]) => params.offset);

// Each test uses its own keyword so SWR's global cache never leaks between them.
const renderSearch = async (keyword: string, loadedChunks: number) => {
  const hook = renderHook(() =>
    useSWRINFxSearch(keyword, null, { limit: CHUNK_SIZE }),
  );
  await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
  await act(async () => {
    await hook.result.current.setSize(loadedChunks);
  });
  expect(hook.result.current.data).toHaveLength(loadedChunks);
  return hook;
};

const removePage0 = (
  chunk: IFormattedSearchResult,
): IFormattedSearchResult => ({
  ...chunk,
  data: chunk.data.filter((page) => page.data.path !== '/page0'),
});

describe('useSWRINFxSearch cache behavior', () => {
  beforeEach(() => {
    apiGetSpy.mockReset();
    apiGetSpy.mockImplementation(respondWithChunk);
  });

  describe('mutateSearchInfiniteChunks (A-1)', () => {
    it('updates the loaded rows without issuing any request', async () => {
      const { result } = await renderSearch('rewrite', 3);
      apiGetSpy.mockClear();

      await act(async () => {
        await mutateSearchInfiniteChunks(result.current.mutate, removePage0);
      });

      const paths = result.current.data?.flatMap((chunk) =>
        chunk.data.map((page) => page.data.path),
      );
      expect(paths).toEqual(['/page1', '/page2', '/page3', '/page4', '/page5']);
      expect(apiGetSpy).not.toHaveBeenCalled();
    });

    it('fetches only the new chunk on the next load, not the rewritten ones', async () => {
      const { result } = await renderSearch('next-load', 3);

      await act(async () => {
        await mutateSearchInfiniteChunks(result.current.mutate, removePage0);
      });
      apiGetSpy.mockClear();

      await act(async () => {
        await result.current.setSize(4);
      });

      expect(result.current.data).toHaveLength(4);
      expect(requestedOffsets()).toEqual([3 * CHUNK_SIZE]);
      // The rewrite survives the load instead of being overwritten by a refetch.
      expect(result.current.data?.[0].data.map((p) => p.data.path)).toEqual([
        '/page1',
      ]);
    });
  });

  describe('retrying a failed chunk with setSize(size) (A-4)', () => {
    it('re-fetches only the failed chunk', async () => {
      const { result } = await renderSearch('retry', 2);

      apiGetSpy.mockClear();
      apiGetSpy.mockRejectedValueOnce(new Error('load failed'));
      await act(async () => {
        await result.current.setSize(3);
      });
      await waitFor(() => expect(result.current.error).toBeDefined());

      apiGetSpy.mockClear();
      await act(async () => {
        await result.current.setSize(result.current.size);
      });

      await waitFor(() => expect(result.current.data).toHaveLength(3));
      expect(requestedOffsets()).toEqual([2 * CHUNK_SIZE]);
    });
  });
});
