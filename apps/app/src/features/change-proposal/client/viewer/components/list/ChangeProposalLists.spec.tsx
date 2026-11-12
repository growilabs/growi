// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import type { SWRInfiniteResponse } from 'swr/infinite';

import type { ChangeProposalSummaryView } from '../../../../interfaces';
import type {
  AppliedProposalsPage,
  MyProposalsPage,
} from '../../stores/use-swrinfx-change-proposal-lists';
import { ChangeProposalLists } from './ChangeProposalLists';

const mocks = vi.hoisted(() => ({
  useMine: vi.fn(),
  useApplied: vi.fn(),
}));

vi.mock('../../stores/use-swrinfx-change-proposal-lists', () => ({
  useSWRInfxMyChangeProposals: mocks.useMine,
  useSWRInfxAppliedChangeProposals: mocks.useApplied,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('~/components/User/UserDate', () => ({
  default: ({ dateTime }: { dateTime: string }) => <span>{dateTime}</span>,
}));

const createSummary = (
  id: string,
  overrides: Partial<ChangeProposalSummaryView> = {},
): ChangeProposalSummaryView => ({
  id,
  requester: { id: 'user-a', username: 'alice', name: 'Alice' },
  entry: 'mcp',
  createdAt: 'CREATED',
  status: 'applied',
  isRequester: false,
  pages: [],
  ...overrides,
});

type Swr<T> = SWRInfiniteResponse<T, Error>;

const swrOf = <T,>(
  data: T[] | undefined,
  rest: Partial<Swr<T>> = {},
): Swr<T> => ({
  data,
  error: undefined,
  isLoading: false,
  isValidating: false,
  size: data?.length ?? 0,
  setSize: vi.fn(),
  mutate: vi.fn(),
  ...rest,
});

const setMine = (pages: MyProposalsPage[] | undefined, rest = {}) =>
  mocks.useMine.mockReturnValue(swrOf(pages, rest));
const setApplied = (pages: AppliedProposalsPage[] | undefined, rest = {}) =>
  mocks.useApplied.mockReturnValue(swrOf(pages, rest));

describe('ChangeProposalLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMine([{ items: [], hasNext: false }]);
    setApplied([{ items: [], nextCursor: null }]);
  });

  it('shows my list first and switches to the applied list with the tabs', () => {
    setMine([
      {
        items: [
          createSummary('mine-a', { pages: [{ id: 'p', path: '/mine/path' }] }),
        ],
        hasNext: false,
      },
    ]);
    setApplied([
      {
        items: [
          createSummary('applied-a', {
            pages: [{ id: 'q', path: '/applied/path' }],
          }),
        ],
        nextCursor: null,
      },
    ]);
    render(<ChangeProposalLists />);
    expect(screen.getByText('/mine/path')).toBeTruthy();
    expect(screen.queryByText('/applied/path')).toBeNull();

    fireEvent.click(
      screen.getByText('change_proposal_viewer.list.tab.applied'),
    );
    expect(screen.getByText('/applied/path')).toBeTruthy();
    expect(screen.queryByText('/mine/path')).toBeNull();
  });

  it('links each item to the detail page', () => {
    setMine([{ items: [createSummary('mine-a')], hasNext: false }]);
    const { container } = render(<ChangeProposalLists />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/me/change-proposals/mine-a',
    );
  });

  it('shows no digits anywhere for counts', () => {
    setMine([
      {
        items: [
          createSummary('mine-a', {
            pages: [
              { id: 'a', path: '/a' },
              { id: 'b', path: '/b' },
              { id: 'c', path: '/c' },
              { id: 'd', path: '/d' },
            ],
          }),
          createSummary('mine-b'),
        ],
        hasNext: true,
      },
    ]);
    const { container } = render(<ChangeProposalLists />);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('shows the path of a deleted page and the page-gone text for a page without a path', () => {
    setMine([
      {
        items: [
          createSummary('mine-a', {
            pages: [{ id: 'a', path: '/deleted/page' }, { id: 'b' }],
          }),
        ],
        hasNext: false,
      },
    ]);
    render(<ChangeProposalLists />);
    expect(screen.getByText('/deleted/page')).toBeTruthy();
    expect(
      screen.getByText('change_proposal_viewer.operation.page_gone'),
    ).toBeTruthy();
  });

  it('shows the no-more text only when the last batch has no further cursor', () => {
    setMine([{ items: [createSummary('mine-a')], hasNext: false }]);
    const { unmount } = render(<ChangeProposalLists />);
    expect(
      screen.getByText('change_proposal_viewer.list.no_more'),
    ).toBeTruthy();
    expect(
      screen.queryByText('change_proposal_viewer.list.load_more'),
    ).toBeNull();
    unmount();

    setMine([{ items: [createSummary('mine-a')], hasNext: true }]);
    render(<ChangeProposalLists />);
    expect(
      screen.queryByText('change_proposal_viewer.list.no_more'),
    ).toBeNull();
    expect(
      screen.getByText('change_proposal_viewer.list.load_more'),
    ).toBeTruthy();
  });

  it('shows the empty text when nothing exists and nothing remains', () => {
    render(<ChangeProposalLists />);
    expect(screen.getByText('change_proposal_viewer.list.empty')).toBeTruthy();
  });

  it('never shows no-more for an empty continuation that still has a cursor', () => {
    setApplied([
      { items: [createSummary('applied-a')], nextCursor: 'cursor-1' },
      { items: [], nextCursor: 'cursor-2' },
    ]);
    render(<ChangeProposalLists />);
    fireEvent.click(
      screen.getByText('change_proposal_viewer.list.tab.applied'),
    );
    expect(
      screen.queryByText('change_proposal_viewer.list.no_more'),
    ).toBeNull();
    expect(screen.queryByText('change_proposal_viewer.list.empty')).toBeNull();
    expect(
      screen.getByText('change_proposal_viewer.list.load_more'),
    ).toBeTruthy();
  });

  it('shows load-more instead of empty when the first applied batch is empty with a cursor', () => {
    setApplied([{ items: [], nextCursor: 'cursor-1' }]);
    render(<ChangeProposalLists />);
    fireEvent.click(
      screen.getByText('change_proposal_viewer.list.tab.applied'),
    );
    expect(screen.queryByText('change_proposal_viewer.list.empty')).toBeNull();
    expect(
      screen.getByText('change_proposal_viewer.list.load_more'),
    ).toBeTruthy();
  });

  it('asks for the next batch when load-more is clicked', () => {
    const setSize = vi.fn();
    setMine([{ items: [createSummary('mine-a')], hasNext: true }], {
      size: 1,
      setSize,
    });
    render(<ChangeProposalLists />);
    fireEvent.click(screen.getByText('change_proposal_viewer.list.load_more'));
    expect(setSize).toHaveBeenCalledWith(2);
  });

  it('keeps the shown items and shows the error when a later fetch fails', () => {
    setMine(
      [
        {
          items: [
            createSummary('mine-a', {
              pages: [{ id: 'a', path: '/kept/path' }],
            }),
          ],
          hasNext: true,
        },
      ],
      { error: new Error('boom') },
    );
    render(<ChangeProposalLists />);
    expect(screen.getByText('/kept/path')).toBeTruthy();
    expect(screen.getByText('change_proposal_viewer.list.error')).toBeTruthy();
    expect(
      screen.queryByText('change_proposal_viewer.list.no_more'),
    ).toBeNull();
  });
});
