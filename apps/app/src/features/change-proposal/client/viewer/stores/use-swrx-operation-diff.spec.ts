// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';

import type { OperationView } from '../../../interfaces';
import { toDiffPair, useSWRxOperationDiff } from './use-swrx-operation-diff';

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

const wrapper = ({ children }: { children?: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children,
  );

const buildOperation = (overrides: Partial<OperationView>): OperationView => ({
  key: 'op-1',
  type: 'edit',
  status: 'applied',
  page: { id: 'page-1', path: '/page-1' },
  baseRevisionId: 'rev-base',
  resultRevisionId: 'rev-result',
  ...overrides,
});

describe('toDiffPair', () => {
  it('pairs the base revision with the created revision for an edit', () => {
    expect(toDiffPair(buildOperation({ type: 'edit' }))).toEqual({
      type: 'pair',
      pair: {
        pageId: 'page-1',
        fromRevisionId: 'rev-base',
        toRevisionId: 'rev-result',
      },
    });
  });

  it('pairs the empty baseline with the created revision for a create', () => {
    expect(
      toDiffPair(buildOperation({ type: 'create', baseRevisionId: undefined })),
    ).toEqual({
      type: 'pair',
      pair: {
        pageId: 'page-1',
        fromRevisionId: null,
        toRevisionId: 'rev-result',
      },
    });
  });

  it.each<OperationView['type']>([
    'move',
    'delete-completely',
  ])('has no diff for %s', (type) => {
    expect(toDiffPair(buildOperation({ type }))).toEqual({
      type: 'no-diff',
    });
  });

  it.each<OperationView['status']>([
    'pending',
    'failed',
    'stale',
    'skipped',
  ])('has no diff for an edit that is %s', (status) => {
    expect(
      toDiffPair(buildOperation({ status, resultRevisionId: undefined })),
    ).toEqual({ type: 'no-diff' });
  });

  it.each<OperationView['type']>([
    'edit',
    'create',
  ])('is unavailable for %s without a page', (type) => {
    expect(toDiffPair(buildOperation({ type, page: undefined }))).toEqual({
      type: 'unavailable',
    });
  });

  it.each<OperationView['type']>([
    'edit',
    'create',
  ])('is unavailable for %s without a result revision', (type) => {
    expect(
      toDiffPair(buildOperation({ type, resultRevisionId: undefined })),
    ).toEqual({ type: 'unavailable' });
  });

  it('is unavailable for an edit without a base revision', () => {
    expect(
      toDiffPair(buildOperation({ type: 'edit', baseRevisionId: undefined })),
    ).toEqual({ type: 'unavailable' });
  });

  it('is unavailable for a reverted create whose page is gone', () => {
    expect(
      toDiffPair(
        buildOperation({
          type: 'create',
          status: 'reverted',
          page: undefined,
        }),
      ),
    ).toEqual({ type: 'unavailable' });
  });
});

describe('useSWRxOperationDiff', () => {
  beforeEach(() => {
    mockedApiv3Post.mockReset();
  });

  it('sends exactly one pair and returns the diff when opened', async () => {
    mockedApiv3Post.mockResolvedValue(
      buildResponse({
        results: [
          {
            pageId: 'page-1',
            toRevisionId: 'rev-result',
            status: 'ok',
            diff: '--- a\n+++ b\n',
          },
        ],
      }),
    );

    const { result } = renderHook(
      () => useSWRxOperationDiff(buildOperation({}), true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      type: 'diff',
      unifiedDiff: '--- a\n+++ b\n',
    });
    expect(mockedApiv3Post).toHaveBeenCalledTimes(1);
    expect(mockedApiv3Post.mock.calls[0][0]).toBe('/revisions/diff');
    expect(mockedApiv3Post.mock.calls[0][1]).toEqual({
      pairs: [
        {
          pageId: 'page-1',
          fromRevisionId: 'rev-base',
          toRevisionId: 'rev-result',
        },
      ],
    });
  });

  it('sends a null baseline for a create', async () => {
    mockedApiv3Post.mockResolvedValue(
      buildResponse({
        results: [
          {
            pageId: 'page-1',
            toRevisionId: 'rev-result',
            status: 'ok',
            diff: '+x\n',
          },
        ],
      }),
    );

    const { result } = renderHook(
      () =>
        useSWRxOperationDiff(
          buildOperation({ type: 'create', baseRevisionId: undefined }),
          true,
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockedApiv3Post.mock.calls[0][1]).toEqual({
      pairs: [
        { pageId: 'page-1', fromRevisionId: null, toRevisionId: 'rev-result' },
      ],
    });
  });

  it('does not request while the diff is closed', async () => {
    const { result } = renderHook(
      () => useSWRxOperationDiff(buildOperation({}), false),
      { wrapper },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.data).toBeUndefined();
    expect(mockedApiv3Post).not.toHaveBeenCalled();
  });

  it('does not request for an operation without a diff', async () => {
    const { result } = renderHook(
      () => useSWRxOperationDiff(buildOperation({ type: 'move' }), true),
      { wrapper },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.data).toBeUndefined();
    expect(mockedApiv3Post).not.toHaveBeenCalled();
  });

  it.each<OperationView['type']>([
    'edit',
    'create',
  ])('is unavailable without any request for a %s with no page', async (type) => {
    const { result } = renderHook(
      () =>
        useSWRxOperationDiff(buildOperation({ type, page: undefined }), true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'unavailable' });
    expect(mockedApiv3Post).not.toHaveBeenCalled();
  });

  it('is unavailable without any request when the result revision is missing', async () => {
    const { result } = renderHook(
      () =>
        useSWRxOperationDiff(
          buildOperation({ resultRevisionId: undefined }),
          true,
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'unavailable' });
    expect(mockedApiv3Post).not.toHaveBeenCalled();
  });

  it.each([
    'forbidden',
    'invalid',
  ])('is unavailable when the API answers %s', async (status) => {
    mockedApiv3Post.mockResolvedValue(
      buildResponse({
        results: [{ pageId: 'page-1', toRevisionId: 'rev-result', status }],
      }),
    );

    const { result } = renderHook(
      () => useSWRxOperationDiff(buildOperation({}), true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'unavailable' });
  });

  it('is unavailable when the request fails', async () => {
    mockedApiv3Post.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(
      () => useSWRxOperationDiff(buildOperation({}), true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'unavailable' });
  });

  it('is unavailable when the response has no result', async () => {
    mockedApiv3Post.mockResolvedValue(buildResponse({ results: [] }));

    const { result } = renderHook(
      () => useSWRxOperationDiff(buildOperation({}), true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'unavailable' });
  });
});
