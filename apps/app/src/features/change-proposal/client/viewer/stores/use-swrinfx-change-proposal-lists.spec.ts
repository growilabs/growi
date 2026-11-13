// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';

import type { ChangeProposalSummaryView } from '../../../interfaces';
import { APPLIED_LIST_AUTO_CONTINUE_LIMIT } from '../consts';
import {
  useSWRInfxAppliedChangeProposals,
  useSWRInfxMyChangeProposals,
} from './use-swrinfx-change-proposal-lists';

vi.mock('~/client/util/apiv3-client');
const mockedApiv3Get = vi.spyOn(apiv3Client, 'apiv3Get');

type ApiResponse = Awaited<ReturnType<typeof apiv3Client.apiv3Get>>;

const buildResponse = (data: unknown): ApiResponse => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: mock<ApiResponse['config']>(),
});

const wrapper = ({ children }: { children?: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children,
  );

// One cache for several mounts, like the app's cache across client-side navigation.
const wrapperSharingCache = () => {
  const cache = new Map();
  return ({ children }: { children?: ReactNode }) =>
    createElement(
      SWRConfig,
      { value: { provider: () => cache, dedupingInterval: 0 } },
      children,
    );
};

const summary = (id: string): ChangeProposalSummaryView =>
  mock<ChangeProposalSummaryView>({ id });

const paramsOf = (call: readonly unknown[]): unknown => call[1];

describe('useSWRInfxMyChangeProposals', () => {
  beforeEach(() => {
    mockedApiv3Get.mockReset();
  });

  it('continues by page number while hasNext is true and stops after', async () => {
    mockedApiv3Get.mockImplementation(async (_path, params) => {
      const page =
        typeof params === 'object' && params != null && 'page' in params
          ? params.page
          : undefined;
      return buildResponse(
        page === 1
          ? { items: [summary('a')], hasNext: true }
          : { items: [summary('b')], hasNext: false },
      );
    });

    const { result } = renderHook(() => useSWRInfxMyChangeProposals(20), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(mockedApiv3Get.mock.calls[0][0]).toBe('/change-proposals/mine');
    expect(paramsOf(mockedApiv3Get.mock.calls[0])).toEqual({
      page: 1,
      limit: 20,
    });

    await act(async () => {
      await result.current.setSize(2);
    });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(paramsOf(mockedApiv3Get.mock.calls[1])).toEqual({
      page: 2,
      limit: 20,
    });

    await act(async () => {
      await result.current.setSize(3);
    });
    expect(mockedApiv3Get).toHaveBeenCalledTimes(2);
  });
});

describe('opening a list again with a warm cache', () => {
  beforeEach(() => {
    mockedApiv3Get.mockReset();
  });

  it('refreshes my list that was cached empty before proposals existed', async () => {
    let items: ChangeProposalSummaryView[] = [];
    mockedApiv3Get.mockImplementation(async () =>
      buildResponse({ items, hasNext: false }),
    );
    const shared = wrapperSharingCache();

    const first = renderHook(() => useSWRInfxMyChangeProposals(20), {
      wrapper: shared,
    });
    await waitFor(() =>
      expect(first.result.current.data?.[0].items).toEqual([]),
    );
    first.unmount();

    items = [summary('a'), summary('b')];
    const second = renderHook(() => useSWRInfxMyChangeProposals(20), {
      wrapper: shared,
    });
    await waitFor(() =>
      expect(second.result.current.data?.[0].items.map((i) => i.id)).toEqual([
        'a',
        'b',
      ]),
    );
  });

  it('refreshes the applied list that was cached empty before proposals existed', async () => {
    let items: ChangeProposalSummaryView[] = [];
    mockedApiv3Get.mockImplementation(async () =>
      buildResponse({ items, nextCursor: null }),
    );
    const shared = wrapperSharingCache();

    const first = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper: shared,
    });
    await waitFor(() =>
      expect(first.result.current.data?.[0].items).toEqual([]),
    );
    first.unmount();

    items = [summary('a')];
    const second = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper: shared,
    });
    await waitFor(() =>
      expect(second.result.current.data?.[0].items.map((i) => i.id)).toEqual([
        'a',
      ]),
    );
  });
});

describe('useSWRInfxAppliedChangeProposals', () => {
  beforeEach(() => {
    mockedApiv3Get.mockReset();
  });

  const cursorOf = (call: readonly unknown[]): unknown => {
    const params = paramsOf(call);
    return typeof params === 'object' && params != null && 'cursor' in params
      ? params.cursor
      : undefined;
  };

  it('continues by the returned cursor and stops when the cursor is null', async () => {
    mockedApiv3Get.mockImplementation(async (_path, params) => {
      const cursor =
        typeof params === 'object' && params != null && 'cursor' in params
          ? params.cursor
          : undefined;
      return buildResponse(
        cursor == null
          ? { items: [summary('a')], nextCursor: 'c1' }
          : { items: [summary('b')], nextCursor: null },
      );
    });

    const { result } = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(mockedApiv3Get.mock.calls[0][0]).toBe('/change-proposals/applied');
    expect(cursorOf(mockedApiv3Get.mock.calls[0])).toBeUndefined();

    await act(async () => {
      await result.current.setSize(2);
    });
    await waitFor(() => expect(result.current.data?.length).toBe(2));
    expect(cursorOf(mockedApiv3Get.mock.calls[1])).toBe('c1');

    await act(async () => {
      await result.current.setSize(3);
    });
    expect(mockedApiv3Get).toHaveBeenCalledTimes(2);
  });

  it('keeps reading empty batches only up to the limit while a cursor remains', async () => {
    let n = 0;
    mockedApiv3Get.mockImplementation(async () => {
      n += 1;
      return buildResponse({ items: [], nextCursor: `c${n}` });
    });

    const { result } = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper,
    });

    // initial batch + LIMIT automatic ones
    await waitFor(() =>
      expect(result.current.data?.length).toBe(
        1 + APPLIED_LIST_AUTO_CONTINUE_LIMIT,
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockedApiv3Get).toHaveBeenCalledTimes(
      1 + APPLIED_LIST_AUTO_CONTINUE_LIMIT,
    );
    const last = result.current.data?.at(-1);
    expect(last?.nextCursor).not.toBeNull();
  });

  it('resumes automatic reading after an explicit setSize past the limit', async () => {
    mockedApiv3Get.mockImplementation(async () =>
      buildResponse({ items: [], nextCursor: 'more' }),
    );
    const { result } = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.data?.length).toBe(
        1 + APPLIED_LIST_AUTO_CONTINUE_LIMIT,
      ),
    );

    await act(async () => {
      await result.current.setSize(2 + APPLIED_LIST_AUTO_CONTINUE_LIMIT);
    });
    await waitFor(() =>
      expect(result.current.data?.length).toBe(
        2 + 2 * APPLIED_LIST_AUTO_CONTINUE_LIMIT,
      ),
    );
  });

  it('stops reading empty batches as soon as the cursor is absent', async () => {
    let n = 0;
    mockedApiv3Get.mockImplementation(async () => {
      n += 1;
      return buildResponse({
        items: [],
        nextCursor: n < 2 ? `c${n}` : null,
      });
    });

    const { result } = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.length).toBe(2));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockedApiv3Get).toHaveBeenCalledTimes(2);
    expect(result.current.data?.at(-1)?.nextCursor).toBeNull();
  });

  it('does not auto-read when the batch has items', async () => {
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ items: [summary('a')], nextCursor: 'c1' }),
    );
    const { result } = renderHook(() => useSWRInfxAppliedChangeProposals(20), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mockedApiv3Get).toHaveBeenCalledTimes(1);
  });
});
