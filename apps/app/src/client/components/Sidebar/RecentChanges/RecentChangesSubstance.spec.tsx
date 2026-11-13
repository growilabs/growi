// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import type { IPageHasId, IRevisionHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import { render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import type { apiv3Post } from '~/client/util/apiv3-client';
import type { useSWRINFxRecentlyUpdated } from '~/stores/page-listing';

import {
  RecentChangesContent,
  RecentChangesHeader,
} from './RecentChangesSubstance';

type RecentlyUpdated = ReturnType<typeof useSWRINFxRecentlyUpdated>;
type Batch = { pages: IPageHasId[]; totalCount: number; offset: number };
type PostResponse = Awaited<ReturnType<typeof apiv3Post>>;

const mocks = vi.hoisted(() => ({
  useSWRINFxRecentlyUpdated: vi.fn(),
  apiv3Post: vi.fn(),
  useIsGuestUser: vi.fn<() => boolean>(),
  useChangeProposalEnabled: vi.fn<() => boolean>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/stores/page-listing', () => ({
  useSWRINFxRecentlyUpdated: mocks.useSWRINFxRecentlyUpdated,
}));
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: mocks.apiv3Post,
}));
vi.mock('~/states/context', () => ({
  useIsGuestUser: mocks.useIsGuestUser,
}));
vi.mock('~/states/server-configurations', () => ({
  useChangeProposalEnabled: mocks.useChangeProposalEnabled,
}));
vi.mock('~/states/search', () => ({
  useSetSearchKeyword: () => vi.fn(),
}));

const makePage = (id: string, revisionId: string): IPageHasId =>
  mock<IPageHasId>({
    _id: id,
    path: `/${id}`,
    revision: revisionId,
    grant: 1,
    wip: false,
    tags: [],
    seenUsers: [],
    commentCount: 0,
    lastUpdateUser: undefined,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });

const makeBatch = (from: number, count: number): Batch => ({
  pages: Array.from({ length: count }, (_, i) =>
    makePage(`page${from + i}`, `rev${from + i}`),
  ),
  totalCount: 100,
  offset: from,
});

const setListing = (data: Batch[]): void => {
  mocks.useSWRINFxRecentlyUpdated.mockReturnValue(
    mock<RecentlyUpdated>({
      data,
      mutate: vi.fn(),
      setSize: vi.fn(),
      isValidating: false,
    }),
  );
};

const marksResponse = (
  marks: { revisionId: string; proposalId: string; isRevert: boolean }[],
): PostResponse => mock<PostResponse>({ data: { marks } });

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderContent = () =>
  render(<RecentChangesContent isSmall={false} isWipPageShown />, { wrapper });

describe('RecentChangesContent proposal marks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    mocks.useIsGuestUser.mockReturnValue(false);
    mocks.useChangeProposalEnabled.mockReturnValue(true);
  });

  it('shows every row while the marks request is still pending, without a mark', () => {
    setListing([makeBatch(0, 3)]);
    mocks.apiv3Post.mockReturnValue(new Promise(() => {}));

    renderContent();

    expect(screen.getByText('page0')).toBeDefined();
    expect(screen.getByText('page1')).toBeDefined();
    expect(screen.getByText('page2')).toBeDefined();
    expect(screen.queryAllByRole('link', { name: /mark\./ })).toHaveLength(0);
  });

  it('keeps showing every row when the marks request fails', async () => {
    setListing([makeBatch(0, 3)]);
    mocks.apiv3Post.mockRejectedValue(new Error('boom'));

    renderContent();

    await waitFor(() => expect(mocks.apiv3Post).toHaveBeenCalled());
    expect(screen.getByText('page0')).toBeDefined();
    expect(screen.getByText('page1')).toBeDefined();
    expect(screen.getByText('page2')).toBeDefined();
    expect(screen.queryAllByRole('link', { name: /mark\./ })).toHaveLength(0);
  });

  it('puts a mark only on the rows whose current revision core returned a mark for', async () => {
    setListing([makeBatch(0, 3)]);
    mocks.apiv3Post.mockResolvedValue(
      marksResponse([
        { revisionId: 'rev1', proposalId: 'prop1', isRevert: false },
      ]),
    );

    renderContent();

    const mark = await screen.findByRole('link', {
      name: 'change_proposal_viewer.mark.change_proposal',
    });
    expect(mark.getAttribute('href')).toBe('/me/change-proposals/prop1');
    expect(screen.queryAllByRole('link', { name: /mark\./ })).toHaveLength(1);
    const row = mark.closest('li');
    expect(row?.textContent).toContain('page1');
    expect(row?.textContent).not.toContain('page0');
  });

  it('puts no mark on a title-only row core returned no mark for, even when the listing carries its proposal', async () => {
    // A row shown by the list display policy: restricted, and its populated
    // revision carries the proposal fields of the existing response.
    const titleOnlyRevision: IRevisionHasId = {
      _id: 'revhidden',
      pageId: 'hidden',
      body: '',
      author: 'someone',
      format: 'markdown',
      proposalId: 'prophidden',
      proposalOperationKey: 'keyhidden',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const titleOnlyRow = mock<IPageHasId>({
      ...makePage('hidden', 'revhidden'),
      grant: PageGrant.GRANT_OWNER,
      revision: titleOnlyRevision,
    });
    setListing([
      {
        pages: [makePage('page0', 'rev0'), titleOnlyRow],
        totalCount: 2,
        offset: 0,
      },
    ]);
    mocks.apiv3Post.mockResolvedValue(
      marksResponse([
        { revisionId: 'rev0', proposalId: 'prop0', isRevert: false },
      ]),
    );

    renderContent();

    const controlMark = await screen.findByRole('link', {
      name: 'change_proposal_viewer.mark.change_proposal',
    });
    expect(controlMark.closest('li')?.textContent).toContain('page0');
    expect(mocks.apiv3Post.mock.calls[0][1].revisionIds).toContain('revhidden');
    const titleOnlyItem = screen.getByText('hidden').closest('li');
    expect(titleOnlyItem?.textContent).toContain('lock');
    expect(titleOnlyItem?.querySelectorAll('a[href*="prop"]')).toHaveLength(0);
    expect(screen.queryAllByRole('link', { name: /mark\./ })).toHaveLength(1);
  });

  it('sends one request per batch and does not refetch earlier batches when more are loaded', async () => {
    setListing([makeBatch(0, 20)]);
    mocks.apiv3Post.mockResolvedValue(marksResponse([]));

    const { rerender } = renderContent();
    await waitFor(() => expect(mocks.apiv3Post).toHaveBeenCalledTimes(1));
    const firstIds = mocks.apiv3Post.mock.calls[0][1].revisionIds;
    expect(firstIds).toHaveLength(20);

    setListing([makeBatch(0, 20), makeBatch(20, 5)]);
    rerender(<RecentChangesContent isSmall={false} isWipPageShown />);

    await waitFor(() => expect(mocks.apiv3Post).toHaveBeenCalledTimes(2));
    const secondIds = mocks.apiv3Post.mock.calls[1][1].revisionIds;
    expect([...secondIds].sort()).toEqual(
      Array.from({ length: 5 }, (_, i) => `rev${20 + i}`).sort(),
    );
    expect(screen.getByText('page24')).toBeDefined();
  });

  it('sends no marks request for a guest and still shows the rows', () => {
    mocks.useIsGuestUser.mockReturnValue(true);
    setListing([makeBatch(0, 3)]);

    renderContent();

    expect(mocks.apiv3Post).not.toHaveBeenCalled();
    expect(screen.getByText('page0')).toBeDefined();
  });
});

describe('RecentChangesHeader link to the change proposal list', () => {
  const renderHeader = () =>
    render(
      <RecentChangesHeader
        isSmall={false}
        onSizeChange={vi.fn()}
        isWipPageShown
        onWipPageShownChange={vi.fn()}
      />,
      { wrapper },
    );

  beforeEach(() => {
    vi.resetAllMocks();
    setListing([]);
    mocks.useIsGuestUser.mockReturnValue(false);
  });

  it('shows the link to a logged-in user when the write feature is enabled', () => {
    mocks.useChangeProposalEnabled.mockReturnValue(true);

    renderHeader();

    expect(
      screen
        .getByRole('link', { name: 'change_proposal_viewer.list.title' })
        .getAttribute('href'),
    ).toBe('/me/change-proposals');
  });

  it('does not show the link when the write feature is disabled', () => {
    mocks.useChangeProposalEnabled.mockReturnValue(false);

    renderHeader();

    expect(
      screen.queryByRole('link', { name: 'change_proposal_viewer.list.title' }),
    ).toBeNull();
  });

  it('does not show the link to a guest even when the write feature is enabled', () => {
    mocks.useChangeProposalEnabled.mockReturnValue(true);
    mocks.useIsGuestUser.mockReturnValue(true);

    renderHeader();

    expect(
      screen.queryByRole('link', { name: 'change_proposal_viewer.list.title' }),
    ).toBeNull();
  });
});
