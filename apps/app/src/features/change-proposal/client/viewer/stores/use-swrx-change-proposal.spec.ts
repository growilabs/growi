// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';

import type { ChangeProposalView } from '../../../interfaces';
import {
  getChangeProposalDetailKey,
  useSWRxChangeProposal,
} from './use-swrx-change-proposal';

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

const proposal = mock<ChangeProposalView>({ id: 'p-found' });

describe('useSWRxChangeProposal', () => {
  beforeEach(() => {
    mockedApiv3Get.mockReset();
  });

  it('returns the proposal as found on success', async () => {
    mockedApiv3Get.mockResolvedValue(buildResponse({ proposal }));

    const { result } = renderHook(() => useSWRxChangeProposal('p-found'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'found', proposal });
    expect(mockedApiv3Get.mock.calls[0][0]).toBe('/change-proposals/p-found');
  });

  it('returns not-found (not an error) for a notfound response', async () => {
    mockedApiv3Get.mockRejectedValue([
      { message: 'Change proposal is not found', code: 'notfound' },
    ]);

    const { result } = renderHook(() => useSWRxChangeProposal('p-missing'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'not-found' });
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces any other failure as an error', async () => {
    mockedApiv3Get.mockRejectedValue([
      { message: 'Failed to get the change proposal', code: 'get-failed' },
    ]);

    const { result } = renderHook(() => useSWRxChangeProposal('p-broken'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });

  it('surfaces a non-array failure (network) as an error', async () => {
    mockedApiv3Get.mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useSWRxChangeProposal('p-net'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.data).toBeUndefined();
  });

  it('treats a list-shaped 200 (id such as mine) as not-found', async () => {
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ items: [], hasNext: false }),
    );

    const { result } = renderHook(() => useSWRxChangeProposal('mine'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ type: 'not-found' });
  });

  it('surfaces an empty errors array as an error', async () => {
    mockedApiv3Get.mockRejectedValue([]);

    const { result } = renderHook(() => useSWRxChangeProposal('p-empty'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeUndefined();
  });

  it('passes SWR config such as refreshInterval through', async () => {
    mockedApiv3Get.mockResolvedValue(buildResponse({ proposal }));

    const { result } = renderHook(
      () => useSWRxChangeProposal('p-poll', { refreshInterval: 20 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() =>
      expect(mockedApiv3Get.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it('does not fetch while the id is null', () => {
    renderHook(() => useSWRxChangeProposal(null), { wrapper });

    expect(mockedApiv3Get).not.toHaveBeenCalled();
  });

  it('escapes the id in the key', () => {
    expect(getChangeProposalDetailKey('a/b')).toBe('/change-proposals/a%2Fb');
  });

  it('exposes the key used for the detail so callers can revalidate it', () => {
    expect(getChangeProposalDetailKey('abc')).toBe('/change-proposals/abc');
  });
});
