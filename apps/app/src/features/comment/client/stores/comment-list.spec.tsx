// @vitest-environment happy-dom

import type { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import { apiv3Get } from '~/client/util/apiv3-client';
import { useShareLinkId } from '~/states/page/hooks';

import type { ListCommentsResponseBody } from '../../interfaces';
import { useSWRxCommentList } from './comment-list';

vi.mock('~/client/util/apiv3-client', () => ({ apiv3Get: vi.fn() }));
vi.mock('~/states/page/hooks', () => ({ useShareLinkId: vi.fn() }));

const wrapper = ({ children }: PropsWithChildren): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

type ListResponse = Awaited<
  ReturnType<typeof apiv3Get<ListCommentsResponseBody>>
>;

const mockResponse = (comments: ListCommentsResponseBody['comments']) => {
  const response = mock<ListResponse>();
  response.data = { comments };
  vi.mocked(apiv3Get).mockResolvedValue(response);
};

describe('useSWRxCommentList', () => {
  beforeEach(() => {
    vi.mocked(apiv3Get).mockReset();
    vi.mocked(useShareLinkId).mockReset();
    vi.mocked(useShareLinkId).mockReturnValue(undefined);
    mockResponse([]);
  });

  it('fetches /comments with only pageId and returns the comments', async () => {
    const { result } = renderHook(() => useSWRxCommentList('page1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(apiv3Get).toHaveBeenCalledTimes(1);
    expect(apiv3Get).toHaveBeenCalledWith('/comments', { pageId: 'page1' });
  });

  it('adds a trimmed shareLinkId to the request when present', async () => {
    vi.mocked(useShareLinkId).mockReturnValue('  link1  ');
    const { result } = renderHook(() => useSWRxCommentList('page1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(apiv3Get).toHaveBeenCalledWith('/comments', {
      pageId: 'page1',
      shareLinkId: 'link1',
    });
  });

  it('treats a blank shareLinkId as absent', async () => {
    vi.mocked(useShareLinkId).mockReturnValue('   ');
    const { result } = renderHook(() => useSWRxCommentList('page1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(apiv3Get).toHaveBeenCalledWith('/comments', { pageId: 'page1' });
  });

  it('does not send page_id', async () => {
    const { result } = renderHook(() => useSWRxCommentList('page1'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([]));
    const params = vi.mocked(apiv3Get).mock.calls[0][1];
    expect(params).not.toHaveProperty('page_id');
  });

  it.each([null, undefined])('does not fetch when pageId is %s', async (id) => {
    const { result } = renderHook(() => useSWRxCommentList(id), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiv3Get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it('uses distinct cache entries with and without a shareLinkId', async () => {
    const { result, rerender } = renderHook(() => useSWRxCommentList('page1'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual([]));

    vi.mocked(useShareLinkId).mockReturnValue('link1');
    rerender();

    await waitFor(() => expect(apiv3Get).toHaveBeenCalledTimes(2));
  });
});
