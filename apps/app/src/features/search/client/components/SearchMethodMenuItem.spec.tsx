import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockFn } from 'vitest-mock-extended';

import type { DownshiftItem, GetItemProps } from '../interfaces/downshift';
import { SearchMethodMenuItem } from './SearchMethodMenuItem';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/states/page', () => ({
  useCurrentPagePath: () => '/foo/bar',
}));

const renderAndCollectItems = (searchKeyword: string): DownshiftItem[] => {
  const items: DownshiftItem[] = [];
  const getItemProps = mockFn<GetItemProps>().mockImplementation((options) => {
    if (options?.item != null) {
      items.push(options.item);
    }
    return { id: 'item', role: 'option', 'aria-selected': false };
  });

  render(
    <SearchMethodMenuItem
      activeIndex={null}
      searchKeyword={searchKeyword}
      getItemProps={getItemProps}
    />,
  );
  return items;
};

describe('SearchMethodMenuItem', () => {
  it('gives the three method items their navigation URL and the keyword to record', () => {
    const items = renderAndCollectItems('hello world');

    expect(items).toEqual([
      {
        type: 'navigate',
        url: '/_search?q=hello world',
        historyKeyword: 'hello world',
      },
      {
        type: 'navigate',
        url: '/_search?q=prefix:/foo/bar hello world',
        historyKeyword: 'hello world',
      },
      {
        type: 'navigate',
        url: '/_search?q="hello world"',
        historyKeyword: '"hello world"',
      },
    ]);
  });

  it('does not put the prefix: operator in the keyword to record for the children item', () => {
    const [, children] = renderAndCollectItems('hello');

    expect(children).toMatchObject({ historyKeyword: 'hello' });
    expect(children).toMatchObject({
      url: expect.stringContaining('prefix:/foo/bar'),
    });
  });

  it('renders only the children item for a blank input', () => {
    const items = renderAndCollectItems('');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'navigate',
      url: '/_search?q=prefix:/foo/bar ',
    });
  });
});
