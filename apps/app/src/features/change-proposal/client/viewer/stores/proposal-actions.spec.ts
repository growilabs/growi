// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import * as apiv3Client from '~/client/util/apiv3-client';
import { mutateRecentlyUpdated } from '~/stores/page-listing';

import type { RevertResult } from '../../../interfaces';
import {
  refreshAfterRevert,
  revertOperations,
  sendRevertRequest,
} from './proposal-actions';
import { useSWRxChangeProposal } from './use-swrx-change-proposal';
import { mutateAllRevisionMarks } from './use-swrx-revision-marks';

vi.mock('~/client/util/apiv3-client');
vi.mock('~/stores/page-listing', () => ({ mutateRecentlyUpdated: vi.fn() }));
vi.mock('./use-swrx-revision-marks', () => ({
  mutateAllRevisionMarks: vi.fn(),
}));

const mockedApiv3Post = vi.spyOn(apiv3Client, 'apiv3Post');
const mockedApiv3Get = vi.spyOn(apiv3Client, 'apiv3Get');

type ApiResponse = Awaited<ReturnType<typeof apiv3Client.apiv3Post>>;

const buildResponse = (data: unknown): ApiResponse => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config: mock<ApiResponse['config']>(),
});

const revertResult: RevertResult = {
  revertProposalId: 'rp1',
  operations: [{ key: 'k1', outcome: 'reverted' }],
};

describe('revertOperations', () => {
  beforeEach(() => {
    mockedApiv3Post.mockReset();
  });

  it('sends exactly the given keys to the revert API and returns the result as is', async () => {
    mockedApiv3Post.mockResolvedValue(buildResponse({ result: revertResult }));

    const actual = await revertOperations('p1', ['k1', 'k3']);

    expect(mockedApiv3Post).toHaveBeenCalledTimes(1);
    expect(mockedApiv3Post).toHaveBeenCalledWith(
      '/change-proposals/p1/revert',
      {
        operationKeys: ['k1', 'k3'],
      },
    );
    expect(actual).toEqual({ type: 'done', result: revertResult });
  });

  it('does not refresh any cache itself', async () => {
    mockedApiv3Post.mockResolvedValue(buildResponse({ result: revertResult }));
    vi.mocked(mutateRecentlyUpdated).mockClear();
    vi.mocked(mutateAllRevisionMarks).mockClear();

    await revertOperations('p1', ['k1']);

    expect(mutateRecentlyUpdated).not.toHaveBeenCalled();
    expect(mutateAllRevisionMarks).not.toHaveBeenCalled();
  });

  it('returns not-found for a notfound response', async () => {
    mockedApiv3Post.mockRejectedValue([
      { message: 'not found', code: 'notfound' },
    ]);

    expect(await revertOperations('p1', ['k1'])).toEqual({
      type: 'not-found',
    });
  });

  it('returns error for any other failure', async () => {
    mockedApiv3Post.mockRejectedValue([
      { message: 'boom', code: 'revert-failed' },
    ]);
    expect(await revertOperations('p1', ['k1'])).toEqual({ type: 'error' });

    mockedApiv3Post.mockRejectedValue(new Error('network'));
    expect(await revertOperations('p1', ['k1'])).toEqual({ type: 'error' });
  });

  it('returns error when the response has no result', async () => {
    mockedApiv3Post.mockResolvedValue(buildResponse({}));

    expect(await revertOperations('p1', ['k1'])).toEqual({ type: 'error' });
  });
});

describe('refreshAfterRevert', () => {
  const wrapper = ({ children }: { children?: ReactNode }) =>
    createElement(
      SWRConfig,
      { value: { dedupingInterval: 0, revalidateOnFocus: false } },
      children,
    );

  beforeEach(() => {
    mockedApiv3Get.mockReset();
    vi.mocked(mutateRecentlyUpdated).mockClear();
    vi.mocked(mutateAllRevisionMarks).mockClear();
  });

  it('refetches the detail, Recent Changes and all revision marks', async () => {
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ proposal: { id: 'p-refresh' } }),
    );
    const { result } = renderHook(() => useSWRxChangeProposal('p-refresh'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockedApiv3Get).toHaveBeenCalledTimes(1);

    await refreshAfterRevert('p-refresh');

    await waitFor(() => expect(mockedApiv3Get).toHaveBeenCalledTimes(2));
    expect(mutateRecentlyUpdated).toHaveBeenCalledTimes(1);
    expect(mutateAllRevisionMarks).toHaveBeenCalledTimes(1);
  });

  it('does not refetch the detail of another proposal', async () => {
    mockedApiv3Get.mockResolvedValue(
      buildResponse({ proposal: { id: 'p-other' } }),
    );
    const { result } = renderHook(() => useSWRxChangeProposal('p-other'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    await refreshAfterRevert('p-unrelated');

    expect(mockedApiv3Get).toHaveBeenCalledTimes(1);
  });
});

describe('sendRevertRequest', () => {
  beforeEach(() => {
    mockedApiv3Post.mockReset();
  });

  it('posts the message and returns sent', async () => {
    mockedApiv3Post.mockResolvedValue(buildResponse({}));

    expect(await sendRevertRequest('p1', 'please revert')).toEqual({
      type: 'sent',
    });
    expect(mockedApiv3Post).toHaveBeenCalledWith(
      '/change-proposals/p1/revert-request',
      { message: 'please revert' },
    );
  });

  it.each([
    ['notfound', 'not-found'],
    ['validation_failed', 'message-too-long'],
    ['revert_request_recently_sent', 'recently-requested'],
    ['own_proposal', 'own-proposal'],
    ['requester_unavailable', 'requester-unavailable'],
    ['something-else', 'unknown'],
  ])('maps the response code %s to %s', async (code, expected) => {
    mockedApiv3Post.mockRejectedValue([{ message: 'x', code }]);

    expect(await sendRevertRequest('p1', 'm')).toEqual({
      type: 'error',
      code: expected,
    });
  });

  it('maps a non-API failure to unknown', async () => {
    mockedApiv3Post.mockRejectedValue(new Error('network'));

    expect(await sendRevertRequest('p1', 'm')).toEqual({
      type: 'error',
      code: 'unknown',
    });
  });
});
