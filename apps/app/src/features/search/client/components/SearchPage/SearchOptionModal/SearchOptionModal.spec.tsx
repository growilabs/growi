import { render, screen } from '@testing-library/react';

import { createEmptyFilterState } from '../../../utils/search-query';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Stub the panel: this suite verifies the modal surfaces it on mobile, not the
// panel's own behavior (which is covered by its own tests).
vi.mock('../SearchFilterPanel', () => ({
  SearchFilterPanel: () => <div data-testid="filter-panel" />,
}));

import { SearchOptionModal } from './SearchOptionModal';

const baseProps = {
  isOpen: true,
  includeUserPages: false,
  includeTrashPages: false,
  disableUserPages: false,
};

describe('SearchOptionModal', () => {
  it('renders the filter panel when filtering is enabled (mobile entry point)', () => {
    render(
      <SearchOptionModal
        {...baseProps}
        isEnableFilter
        filters={createEmptyFilterState()}
        onFiltersChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('filter-panel')).toBeInTheDocument();
  });

  it('does not render the filter panel when filtering is disabled', () => {
    render(
      <SearchOptionModal
        {...baseProps}
        isEnableFilter={false}
        filters={createEmptyFilterState()}
        onFiltersChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument();
  });
});
