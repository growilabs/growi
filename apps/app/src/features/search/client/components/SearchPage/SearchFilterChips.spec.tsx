import { fireEvent, render, screen } from '@testing-library/react';

import {
  createEmptyFilterState,
  type SearchFilterState,
} from '../../utils/search-query';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import { SearchFilterChips } from './SearchFilterChips';

const filtersOf = (
  overrides: Partial<SearchFilterState>,
): SearchFilterState => ({
  ...createEmptyFilterState(),
  ...overrides,
});

describe('SearchFilterChips', () => {
  it('renders a chip for every active filter value', () => {
    render(
      <SearchFilterChips
        filters={filtersOf({ authors: ['alice'], tags: ['help', 'guide'] })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('help')).toBeInTheDocument();
    expect(screen.getByText('guide')).toBeInTheDocument();
  });

  it('exposes the chips as a labelled group for assistive tech', () => {
    render(
      <SearchFilterChips
        filters={filtersOf({ authors: ['alice'] })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
  });

  it('renders a single chip for a duplicated value', () => {
    render(
      <SearchFilterChips
        filters={filtersOf({ authors: ['alice', 'alice'] })}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText('alice')).toHaveLength(1);
  });

  it('renders nothing when no filter is set', () => {
    const { container } = render(
      <SearchFilterChips
        filters={createEmptyFilterState()}
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('removes only the clicked value, keeping the rest of the field', () => {
    const onChange = vi.fn();
    render(
      <SearchFilterChips
        filters={filtersOf({ tags: ['help', 'guide'] })}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Tag: help' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['guide'] }),
    );
  });

  it('moves focus to the clear-all button after removing a chip', () => {
    render(
      <SearchFilterChips
        filters={filtersOf({ tags: ['help', 'guide'] })}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Tag: help' }));

    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveFocus();
  });

  it('clears every field when "clear all" is clicked', () => {
    const onChange = vi.fn();
    render(
      <SearchFilterChips
        filters={filtersOf({ authors: ['alice'], groups: ['eng'] })}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith(createEmptyFilterState());
  });
});
