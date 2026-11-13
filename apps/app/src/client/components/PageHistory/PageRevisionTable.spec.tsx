// @vitest-environment happy-dom

import type { ReactNode } from 'react';
import type { IRevisionHasId } from '@growi/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { mock } from 'vitest-mock-extended';

import type { apiv3Post } from '~/client/util/apiv3-client';
import type { useSWRxInfinitePageRevisions } from '~/stores/page';

import { PageRevisionTable } from './PageRevisionTable';

type InfiniteRevisions = ReturnType<typeof useSWRxInfinitePageRevisions>;
type PostResponse = Awaited<ReturnType<typeof apiv3Post>>;
type RevisionsPage = { revisions: IRevisionHasId[]; offset: number };

const mocks = vi.hoisted(() => ({
  useSWRxInfinitePageRevisions: vi.fn(),
  apiv3Post: vi.fn(),
  useIsGuestUser: vi.fn<() => boolean>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/stores/page', () => ({
  useSWRxInfinitePageRevisions: mocks.useSWRxInfinitePageRevisions,
}));
vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Post: mocks.apiv3Post,
}));
vi.mock('~/states/context', () => ({
  useIsGuestUser: mocks.useIsGuestUser,
}));
vi.mock('../RevisionComparer/RevisionComparer', () => ({
  RevisionComparer: () => <div data-testid="revision-comparer" />,
}));

const makeRevision = (id: string, hasDiffToPrev = true): IRevisionHasId =>
  mock<IRevisionHasId>({
    _id: id,
    author: `author-${id}`,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    hasDiffToPrev,
  });

const makeRevisions = (from: number, count: number): IRevisionHasId[] =>
  Array.from({ length: count }, (_, i) => makeRevision(`rev${from + i}`));

const setRevisions = (pages: RevisionsPage[]): void => {
  mocks.useSWRxInfinitePageRevisions.mockReturnValue(
    mock<InfiniteRevisions>({
      data: pages,
      size: pages.length,
      error: undefined,
      isValidating: false,
      setSize: vi.fn(),
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

const MARK_NAME = 'change_proposal_viewer.mark.change_proposal';

const table = (extra: { source?: string; target?: string } = {}) => (
  <PageRevisionTable
    sourceRevisionId={extra.source}
    targetRevisionId={extra.target}
    onClose={vi.fn()}
    currentPageId="page1"
    currentPagePath="/page1"
  />
);

const rowOf = (revisionId: string): HTMLElement | null =>
  document.getElementById(`compareSource-${revisionId}`)?.closest('tr') ?? null;

describe('PageRevisionTable proposal marks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.useIsGuestUser.mockReturnValue(false);
  });

  it('puts a mark only on the rows core returned a mark for, beside the Latest badge', async () => {
    setRevisions([{ revisions: makeRevisions(0, 3), offset: 0 }]);
    mocks.apiv3Post.mockResolvedValue(
      marksResponse([
        { revisionId: 'rev0', proposalId: 'prop0', isRevert: false },
      ]),
    );

    render(table(), { wrapper });

    const mark = await screen.findByRole('link', { name: MARK_NAME });
    expect(mark.getAttribute('href')).toBe('/me/change-proposals/prop0');
    expect(screen.queryAllByRole('link', { name: /mark\./ })).toHaveLength(1);
    expect(rowOf('rev0')?.contains(mark)).toBe(true);
    expect(mark.closest('.revision-history-author')?.textContent).toContain(
      'Latest',
    );
  });

  it('shows the mark in the compact row of a revision without a diff', async () => {
    setRevisions([
      {
        revisions: [makeRevision('rev0'), makeRevision('rev1', false)],
        offset: 0,
      },
    ]);
    mocks.apiv3Post.mockResolvedValue(
      marksResponse([
        { revisionId: 'rev1', proposalId: 'prop1', isRevert: true },
      ]),
    );

    render(table(), { wrapper });

    const mark = await screen.findByRole('link', {
      name: 'change_proposal_viewer.mark.revert',
    });
    expect(rowOf('rev1')?.contains(mark)).toBe(true);
    expect(rowOf('rev1')?.textContent).toContain('No diff');
  });

  it('requests marks for the revisions loaded later too', async () => {
    setRevisions([{ revisions: makeRevisions(0, 10), offset: 0 }]);
    mocks.apiv3Post.mockResolvedValue(marksResponse([]));

    const { rerender } = render(table(), { wrapper });
    await waitFor(() => expect(mocks.apiv3Post).toHaveBeenCalledTimes(1));

    setRevisions([
      { revisions: makeRevisions(0, 10), offset: 0 },
      { revisions: makeRevisions(10, 2), offset: 10 },
    ]);
    mocks.apiv3Post.mockResolvedValue(
      marksResponse([
        { revisionId: 'rev11', proposalId: 'prop11', isRevert: false },
      ]),
    );
    rerender(table());

    const mark = await screen.findByRole('link', { name: MARK_NAME });
    expect(rowOf('rev11')?.contains(mark)).toBe(true);
    const lastIds = mocks.apiv3Post.mock.calls.at(-1)?.[1].revisionIds;
    expect(lastIds).toContain('rev10');
    expect(lastIds).toContain('rev11');
  });

  it('splits the marks request when more than 100 revisions are loaded at once', async () => {
    setRevisions([{ revisions: makeRevisions(0, 150), offset: 0 }]);
    mocks.apiv3Post.mockResolvedValue(marksResponse([]));

    render(table({ source: 'rev1', target: 'rev0' }), { wrapper });

    await waitFor(() => expect(mocks.apiv3Post).toHaveBeenCalledTimes(2));
    const sizes = mocks.apiv3Post.mock.calls
      .map((call) => call[1].revisionIds.length)
      .sort((a, b) => b - a);
    expect(sizes).toEqual([100, 50]);
  });

  it('keeps the history and its compare controls working when the marks request fails', async () => {
    setRevisions([{ revisions: makeRevisions(0, 3), offset: 0 }]);
    mocks.apiv3Post.mockRejectedValue(new Error('boom'));

    render(table(), { wrapper });

    await waitFor(() => expect(mocks.apiv3Post).toHaveBeenCalled());
    expect(screen.queryAllByRole('link', { name: /mark\./ })).toHaveLength(0);
    expect(
      screen.getAllByText('Go to this version', { exact: false }),
    ).toHaveLength(3);

    const source = document.getElementById('compareSource-rev2');
    expect(source).not.toBeNull();
    fireEvent.click(source as HTMLElement);
    expect((source as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('revision-comparer')).toBeDefined();
  });

  it('sends no marks request for a guest and still shows the rows', () => {
    mocks.useIsGuestUser.mockReturnValue(true);
    setRevisions([{ revisions: makeRevisions(0, 3), offset: 0 }]);

    render(table(), { wrapper });

    expect(mocks.apiv3Post).not.toHaveBeenCalled();
    expect(rowOf('rev0')).not.toBeNull();
  });
});
