// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';

import type { RevisionMarkView } from '../../../interfaces';
import {
  mutateAllRevisionMarks,
  useSWRxRevisionMarks,
} from './use-swrx-revision-marks';

vi.mock('~/client/util/apiv3-client');
const mockedApiv3Post = vi.spyOn(apiv3Client, 'apiv3Post');

type ApiResponse = Awaited<ReturnType<typeof apiv3Client.apiv3Post>>;

const buildResponse = (data: unknown): ApiResponse => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: mock<ApiResponse['config']>(),
});

const requestedIds = (params: unknown): readonly string[] => {
  if (
    typeof params === 'object' &&
    params !== null &&
    'revisionIds' in params &&
    Array.isArray(params.revisionIds)
  ) {
    return params.revisionIds.filter(
      (id): id is string => typeof id === 'string',
    );
  }
  return [];
};

const mark = (revisionId: string, isRevert = false): RevisionMarkView => ({
  revisionId,
  proposalId: `proposal-of-${revisionId}`,
  isRevert,
});

// Global mutate targets the default cache, so tests isolate by using unique ids
// per case instead of a per-render cache provider.
let seq = 0;
const makeIds = (count: number): string[] => {
  seq += 1;
  return Array.from(
    { length: count },
    (_, i) => `t${seq}-${String(i).padStart(4, '0')}`,
  );
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0 } }, children);

const echoMarks = () =>
  mockedApiv3Post.mockImplementation(async (_path, params) => {
    return buildResponse({
      marks: requestedIds(params).map((id) => mark(id)),
    });
  });

describe('useSWRxRevisionMarks', () => {
  beforeEach(() => {
    mockedApiv3Post.mockReset();
  });

  it.each([
    ['null', null],
    ['an empty list', []],
  ])('sends no request when the ids are %s', async (_label, ids) => {
    const { result } = renderHook(() => useSWRxRevisionMarks(ids), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedApiv3Post).not.toHaveBeenCalled();
    expect(result.current.marks.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('posts 150 ids as exactly two requests of 100 and 50', async () => {
    echoMarks();
    const ids = makeIds(150);

    const { result } = renderHook(() => useSWRxRevisionMarks(ids), { wrapper });
    await waitFor(() => expect(result.current.marks.size).toBe(150));

    expect(mockedApiv3Post).toHaveBeenCalledTimes(2);
    const sizes = mockedApiv3Post.mock.calls.map(
      ([, params]) => requestedIds(params).length,
    );
    expect(sizes).toEqual([100, 50]);
    expect(mockedApiv3Post.mock.calls[0][0]).toBe(
      '/change-proposals/revision-marks',
    );
  });

  it('merges the marks of every chunk so they can be looked up by revision id', async () => {
    echoMarks();
    const ids = makeIds(101);

    const { result } = renderHook(() => useSWRxRevisionMarks(ids), { wrapper });
    await waitFor(() => expect(result.current.marks.size).toBe(101));

    expect(result.current.marks.get(ids[0])).toEqual(mark(ids[0]));
    expect(result.current.marks.get(ids[100])).toEqual(mark(ids[100]));
  });

  it('is loading with empty marks until the response arrives', async () => {
    echoMarks();
    const ids = makeIds(1);

    const { result } = renderHook(() => useSWRxRevisionMarks(ids), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.marks.size).toBe(0);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.marks.size).toBe(1);
  });

  it('returns empty marks without throwing when a request fails', async () => {
    mockedApiv3Post.mockRejectedValue(new Error('boom'));
    const ids = makeIds(3);

    const { result } = renderHook(() => useSWRxRevisionMarks(ids), { wrapper });
    await waitFor(() => expect(mockedApiv3Post).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.marks.size).toBe(0);
  });
});

describe('mutateAllRevisionMarks', () => {
  beforeEach(() => {
    mockedApiv3Post.mockReset();
  });

  it('refetches the marks that are already cached', async () => {
    echoMarks();
    const ids = makeIds(2);
    const { result } = renderHook(() => useSWRxRevisionMarks(ids), { wrapper });
    await waitFor(() => expect(result.current.marks.size).toBe(2));
    expect(mockedApiv3Post).toHaveBeenCalledTimes(1);

    mockedApiv3Post.mockImplementation(async (_path, params) => {
      return buildResponse({
        marks: requestedIds(params).map((id) => mark(id, true)),
      });
    });
    await act(async () => {
      await mutateAllRevisionMarks();
    });

    expect(mockedApiv3Post).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(result.current.marks.get(ids[0])?.isRevert).toBe(true),
    );
  });
});
