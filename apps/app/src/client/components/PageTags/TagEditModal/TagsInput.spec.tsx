import type { FC } from 'react';
import { act, render } from '@testing-library/react';

import { TagsInput } from './TagsInput';

// Capture every props object AsyncTypeahead is rendered with, so tests can
// inspect prop identity across re-renders without depending on the real
// library's internal debounce/cancellation behavior.
const onSearchCalls: Array<(query: string) => void> = [];

vi.mock('react-bootstrap-typeahead', () => ({
  AsyncTypeahead: (props: { onSearch: (query: string) => void }) => {
    onSearchCalls.push(props.onSearch);
    return <div data-testid="async-typeahead" />;
  },
  Token: (() => null) as unknown as FC,
}));

let mockTagsSearchData: string[] | undefined;

vi.mock('~/stores/tag', () => ({
  useSWRxTagsSearch: () => ({
    data: mockTagsSearchData && { ok: true, tags: mockTagsSearchData },
    error: undefined,
  }),
}));

describe('TagsInput', () => {
  beforeEach(() => {
    onSearchCalls.length = 0;
    mockTagsSearchData = undefined;
  });

  it('keeps the onSearch handler passed to AsyncTypeahead referentially stable across a search-result update', () => {
    const { rerender } = render(
      <TagsInput tags={[]} autoFocus={false} onTagsUpdated={vi.fn()} />,
    );
    const handlerBeforeResults = onSearchCalls.at(-1);

    // Simulate the SWR cache resolving new search results (what happens
    // right after the initial empty-query search returns).
    act(() => {
      mockTagsSearchData = ['existing-tag'];
    });
    rerender(<TagsInput tags={[]} autoFocus={false} onTagsUpdated={vi.fn()} />);
    const handlerAfterResults = onSearchCalls.at(-1);

    // If this handler's identity changes whenever search results arrive,
    // react-bootstrap-typeahead recreates its debounced search internally and
    // cancels any search still pending from user input — silently dropping
    // typed queries. See PR #11738.
    expect(handlerAfterResults).toBe(handlerBeforeResults);
  });

  it('does not mutate the SWR-cached tags array when a search is triggered', () => {
    mockTagsSearchData = ['cached-tag'];
    const cachedTagsRef = mockTagsSearchData;

    render(<TagsInput tags={[]} autoFocus={false} onTagsUpdated={vi.fn()} />);
    const searchHandler = onSearchCalls.at(-1);

    act(() => {
      searchHandler?.('new-query');
    });

    expect(cachedTagsRef).toEqual(['cached-tag']);
  });
});
