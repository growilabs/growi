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

// Interpolation values are rendered, so a count passed to t() shows up in the text.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options == null ? key : `${key}${JSON.stringify(options)}`,
  }),
}));

vi.mock('~/components/User/UserDate', () => ({
  default: ({ dateTime }: { dateTime: string }) => <span>{dateTime}</span>,
}));

const PAGE_GONE = 'change_proposal_viewer.operation.page_gone';
const SHOW_MORE = 'change_proposal_viewer.list.show_more_pages';
const PATH_MARK = '<path>';

// Digit-free names, so that any digit in the display can only come from the viewer.
const letterName = (n: number): string =>
  `${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}`;

const buildPages = (
  count: number,
): ChangeProposalSummaryView['pages'][number][] =>
  Array.from({ length: count }, (_, n) => ({
    id: `id${letterName(n)}`,
    path: `/team/${letterName(n)}`,
  }));

const buildSummary = (
  id: string,
  pages: ChangeProposalSummaryView['pages'],
): ChangeProposalSummaryView => ({
  id,
  requester: { id: 'userabc', username: 'alice', name: 'Alice' },
  entry: 'mcp',
  createdAt: 'CREATEDAT',
  lastAppliedAt: 'LASTAPPLIEDAT',
  status: 'applied',
  isRequester: false,
  pages,
});

type Swr<T> = SWRInfiniteResponse<T, Error>;

const swrOf = <T,>(data: T[]): Swr<T> => ({
  data,
  error: undefined,
  isLoading: false,
  isValidating: false,
  size: data.length,
  setSize: vi.fn(),
  mutate: vi.fn(),
});

const setMine = (pages: MyProposalsPage[]) =>
  mocks.useMine.mockReturnValue(swrOf(pages));
const setApplied = (pages: AppliedProposalsPage[]) =>
  mocks.useApplied.mockReturnValue(swrOf(pages));

type Shape = {
  readonly head: string;
  readonly tail: string;
  readonly between: readonly string[];
};

const shapeOf = (text: string, paths: readonly string[]): Shape => {
  const marked = paths.reduce(
    (acc, path) => acc.replaceAll(path, PATH_MARK),
    text,
  );
  const segments = marked.split(PATH_MARK);
  return {
    head: segments[0],
    tail: segments[segments.length - 1],
    between: [...new Set(segments.slice(1, -1))],
  };
};

describe('ChangeProposalLists does not disclose how many pages or proposals exist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMine([{ items: [], hasNext: false }]);
    setApplied([{ items: [], nextCursor: null }]);
  });

  it('renders an item the same way whether it has 4 or 12 visible pages, and lists every page alike once expanded', () => {
    const collapsed = new Map<number, string>();
    const expanded = new Map<number, Shape>();

    for (const count of [1, 4, 12]) {
      const pages = buildPages(count);
      setMine([{ items: [buildSummary('mineabc', pages)], hasNext: false }]);
      const { container, unmount } = render(<ChangeProposalLists />);
      collapsed.set(count, container.textContent ?? '');
      const showMore = screen.queryByText(SHOW_MORE);
      if (showMore != null) {
        fireEvent.click(showMore);
      }
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/\d/);
      expanded.set(
        count,
        shapeOf(
          text,
          pages.flatMap((p) => (p.path == null ? [] : [p.path])),
        ),
      );
      unmount();
    }

    expect(collapsed.get(4)).not.toMatch(/\d/);
    expect(collapsed.get(12)).toBe(collapsed.get(4));
    const [one, four, twelve] = [1, 4, 12].map((c) => expanded.get(c));
    expect(four).toEqual(twelve);
    expect(four?.head).toBe(one?.head);
    expect(four?.tail).toBe(one?.tail);
  });

  it.each([
    ['mine', false],
    ['applied', true],
  ])('renders the %s list the same way for 1, 4 and 12 proposals', (_label, isApplied) => {
    const shapes = new Map<number, Shape>();

    for (const count of [1, 4, 12]) {
      const items = Array.from({ length: count }, (_, n) =>
        buildSummary(`proposal${letterName(n)}`, [
          { id: `id${letterName(n)}`, path: `/team/${letterName(n)}` },
        ]),
      );
      setMine([{ items: isApplied ? [] : items, hasNext: false }]);
      setApplied([{ items: isApplied ? items : [], nextCursor: null }]);
      const { container, unmount } = render(<ChangeProposalLists />);
      if (isApplied) {
        fireEvent.click(
          screen.getByText('change_proposal_viewer.list.tab.applied'),
        );
      }
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/\d/);
      shapes.set(
        count,
        shapeOf(
          text,
          items.flatMap((item) => item.pages.map((p) => p.path ?? '')),
        ),
      );
      unmount();
    }

    const [one, four, twelve] = [1, 4, 12].map((c) => shapes.get(c));
    expect(four).toEqual(twelve);
    expect(four?.between).toHaveLength(1);
    expect(four?.head).toBe(one?.head);
    expect(four?.tail).toBe(one?.tail);
  });

  it('shows exactly the paths core returned and the page-gone text for pages without one', () => {
    setMine([
      {
        items: [
          buildSummary('mineabc', [
            { id: 'idgoneone' },
            { id: 'idkept', path: '/kept/path' },
            { id: 'idgonetwo' },
          ]),
        ],
        hasNext: false,
      },
    ]);

    const { container } = render(<ChangeProposalLists />);

    const text = container.textContent ?? '';
    const { head, between, tail } = shapeOf(text, ['/kept/path']);
    expect(between).toEqual([]);
    expect(head.endsWith(PAGE_GONE)).toBe(true);
    expect(head.split(PAGE_GONE)).toHaveLength(2);
    expect(tail.startsWith(PAGE_GONE)).toBe(true);
    expect(tail.split(PAGE_GONE)).toHaveLength(2);
    expect(text).not.toContain('idgone');
  });
});
