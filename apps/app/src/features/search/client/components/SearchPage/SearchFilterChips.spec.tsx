import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

// Controlled harness so an onChange that empties the filters actually re-renders
// and unmounts the chip bar — the condition under which focus must hand off to
// the fallback element. A no-op onChange would keep the bar mounted and hide the bug.
const ControlledChips = ({
  initialFilters,
}: {
  initialFilters: SearchFilterState;
}) => {
  const [filters, setFilters] = useState(initialFilters);
  const fallbackRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={fallbackRef} data-testid="fallback" readOnly />
      <SearchFilterChips
        filters={filters}
        onChange={setFilters}
        fallbackFocusRef={fallbackRef}
      />
    </>
  );
};

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

  it('removes only the clicked value, keeping the rest of the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchFilterChips
        filters={filtersOf({ tags: ['help', 'guide'] })}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Tag: help' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['guide'] }),
    );
  });

  it('moves focus to the clear-all button after removing a chip', async () => {
    const user = userEvent.setup();
    render(
      <SearchFilterChips
        filters={filtersOf({ tags: ['help', 'guide'] })}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Tag: help' }));

    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveFocus();
  });

  it('clears every field when "clear all" is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchFilterChips
        filters={filtersOf({ authors: ['alice'], groups: ['eng'] })}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith(createEmptyFilterState());
  });

  it('hands focus to the fallback element when removing the last chip unmounts the bar', async () => {
    const user = userEvent.setup();
    render(<ControlledChips initialFilters={filtersOf({ tags: ['help'] })} />);

    await user.click(screen.getByRole('button', { name: 'Remove Tag: help' }));

    // The bar unmounts once no filter remains, so focus must not fall to <body>.
    expect(
      screen.queryByRole('button', { name: 'Clear all' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toHaveFocus();
  });

  it('hands focus to the fallback element when "clear all" unmounts the bar', async () => {
    const user = userEvent.setup();
    render(
      <ControlledChips
        initialFilters={filtersOf({ authors: ['alice'], tags: ['help'] })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(
      screen.queryByRole('group', { name: 'Filters' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('fallback')).toHaveFocus();
  });
});
