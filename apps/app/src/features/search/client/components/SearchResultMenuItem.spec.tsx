import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockFn } from 'vitest-mock-extended';

import type { DownshiftItem, GetItemProps } from '../interfaces/downshift';
import { SearchResultMenuItem } from './SearchResultMenuItem';

vi.mock('usehooks-ts', () => ({ useDebounce: (value: string) => value }));
vi.mock('@growi/ui/dist/components', () => ({
  PagePathLabel: () => null,
  UserPicture: () => null,
}));
vi.mock('~/stores/search', () => ({
  useSWRxSearch: () => ({
    isLoading: false,
    data: {
      data: [
        {
          data: {
            _id: 'page-1',
            path: '/page-1',
            creator: {},
            seenUsers: [],
          },
        },
        {
          data: {
            _id: 'page-2',
            path: '/page-2',
            creator: {},
            seenUsers: [],
          },
        },
      ],
    },
  }),
}));

describe('SearchResultMenuItem', () => {
  it('navigates to the page and carries no keyword to record', () => {
    const items: DownshiftItem[] = [];
    const getItemProps = mockFn<GetItemProps>().mockImplementation(
      (options) => {
        if (options?.item != null) {
          items.push(options.item);
        }
        return { id: 'item', role: 'option', 'aria-selected': false };
      },
    );

    render(
      <SearchResultMenuItem
        activeIndex={null}
        searchKeyword="page"
        getItemProps={getItemProps}
      />,
    );

    expect(items).toEqual([
      { type: 'navigate', url: 'page-1' },
      { type: 'navigate', url: 'page-2' },
    ]);
    expect(items.every((item) => !('historyKeyword' in item))).toBe(true);
  });
});
