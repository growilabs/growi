import type { IPageHasId } from '@growi/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mock } from 'vitest-mock-extended';

import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import { useSWRxSearch } from '~/stores/search';

import type { GetItemProps } from '../interfaces/downshift';
import { SearchResultMenuItem } from './SearchResultMenuItem';

vi.mock('~/stores/search', () => ({
  useSWRxSearch: vi.fn(),
}));

// A deep path (5 ancestors + page name) so middle truncation is observable.
const DEEP_PATH = '/Projects/GROWI/team/notes/memo';
const SEEN_USERS_COUNT = 5;

const buildSearchResultItem = (): IPageWithSearchMeta =>
  mock<IPageWithSearchMeta>({
    data: mock<IPageHasId>({
      _id: 'page-1',
      path: DEEP_PATH,
      // A plain string ref keeps UserPicture on its no-link/no-tooltip path,
      // so the test needs no next/router mock.
      creator: 'creator-id',
      seenUsers: Array.from(
        { length: SEEN_USERS_COUNT },
        (_, i) => `seen-user-${i}`,
      ),
    }),
  });

const mockSearchResult = (item: IPageWithSearchMeta): void => {
  vi.mocked(useSWRxSearch).mockReturnValue(
    mock<ReturnType<typeof useSWRxSearch>>({
      data: mock<IFormattedSearchResult>({
        data: [item],
        meta: { total: 1, hitsCount: 1 },
      }),
      isLoading: false,
    }),
  );
};

// getItemProps stub that mimics Downshift: it returns props (incl. onClick)
// that the row spreads onto its <li>, so click-through can be observed.
const setupGetItemProps = (): {
  getItemProps: GetItemProps;
  onItemClick: ReturnType<typeof vi.fn>;
} => {
  const onItemClick = vi.fn();
  // WHY: Downshift's getItemProps return type merges dozens of DOM/a11y props;
  // reproducing it faithfully adds no test value, so cast the minimal stub.
  const getItemProps = vi.fn((options: { className?: string }) => ({
    onClick: onItemClick,
    className: options.className,
    role: 'option',
  })) as unknown as GetItemProps;
  return { getItemProps, onItemClick };
};

describe('SearchResultMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('page path display (integration with SearchResultPagePath)', () => {
    it('should render the path via the truncated breadcrumb display', () => {
      mockSearchResult(buildSearchResultItem());
      const { getItemProps } = setupGetItemProps();

      render(
        <SearchResultMenuItem
          activeIndex={null}
          searchKeyword="memo"
          getItemProps={getItemProps}
        />,
      );

      // The middle ancestors are collapsed into a single ellipsis node,
      // which the old PagePathLabel display never produced.
      const ellipses = screen.getAllByText('…');
      expect(ellipses).toHaveLength(1);

      // First ancestor and parent ancestor are rendered as their own nodes.
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('notes')).toBeInTheDocument();

      // The page name is emphasized (bold).
      expect(screen.getByText('memo').tagName).toBe('STRONG');
    });

    it('should not wrap the path onto multiple lines (no text-wrap span)', () => {
      mockSearchResult(buildSearchResultItem());
      const { getItemProps } = setupGetItemProps();

      const { container } = render(
        <SearchResultMenuItem
          activeIndex={null}
          searchKeyword="memo"
          getItemProps={getItemProps}
        />,
      );

      expect(container.querySelector('.text-wrap')).toBeNull();
      expect(container.querySelector('.text-break')).toBeNull();
    });

    it('should let the path fill the row and shrink below its content width', () => {
      mockSearchResult(buildSearchResultItem());
      const { getItemProps } = setupGetItemProps();

      const { container } = render(
        <SearchResultMenuItem
          activeIndex={null}
          searchKeyword="memo"
          getItemProps={getItemProps}
        />,
      );

      // The wrapper that owns the path must grow and be allowed to shrink
      // (min-width:0) so the 1-line ellipsis can engage.
      const wrapper = container.querySelector('.flex-grow-1');
      expect(wrapper).not.toBeNull();
      expect((wrapper as HTMLElement).style.minWidth).toMatch(/^0(px)?$/);
      expect(wrapper?.textContent).toContain('memo');
    });
  });

  describe('non-destructive: footprint (seen users count)', () => {
    it('should still render the seen-users count', () => {
      mockSearchResult(buildSearchResultItem());
      const { getItemProps } = setupGetItemProps();

      const { container } = render(
        <SearchResultMenuItem
          activeIndex={null}
          searchKeyword="memo"
          getItemProps={getItemProps}
        />,
      );

      expect(screen.getByText(String(SEEN_USERS_COUNT))).toBeInTheDocument();

      // The footprint must not be squeezed out of the row.
      expect(container.querySelector('.flex-shrink-0')).not.toBeNull();
    });
  });

  describe('non-destructive: click-through (Downshift wiring)', () => {
    it('should wire each result row through getItemProps', () => {
      const item = buildSearchResultItem();
      mockSearchResult(item);
      const { getItemProps } = setupGetItemProps();

      render(
        <SearchResultMenuItem
          activeIndex={null}
          searchKeyword="memo"
          getItemProps={getItemProps}
        />,
      );

      expect(getItemProps).toHaveBeenCalledWith(
        expect.objectContaining({ item: { url: item.data._id } }),
      );
    });

    it('should trigger the navigation handler when the row is clicked', async () => {
      mockSearchResult(buildSearchResultItem());
      const { getItemProps, onItemClick } = setupGetItemProps();

      const { container } = render(
        <SearchResultMenuItem
          activeIndex={null}
          searchKeyword="memo"
          getItemProps={getItemProps}
        />,
      );

      const row = container.querySelector('li');
      expect(row).not.toBeNull();

      await userEvent.click(row as HTMLElement);

      expect(onItemClick).toHaveBeenCalledTimes(1);
    });
  });
});
