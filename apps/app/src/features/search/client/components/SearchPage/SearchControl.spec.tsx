import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { useSearchModalStatus } from '../../states/modal/search';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

import SearchControl from './SearchControl';

type SearchHistoryProp = { isSearchHistoryEnabled?: boolean };

const renderSearchControl = (props: SearchHistoryProp = {}) =>
  render(
    <SearchControl
      isEnableSort={false}
      isEnableFilter={false}
      disableUserPages
      initialSearchConditions={{ keyword: 'foo' }}
      extraControls={null}
      {...props}
    />,
  );

describe('SearchControl', () => {
  it('opens the search modal with search history disabled when isSearchHistoryEnabled is false', () => {
    const { result } = renderHook(() => useSearchModalStatus());
    renderSearchControl({ isSearchHistoryEnabled: false });

    fireEvent.click(screen.getByDisplayValue('foo'));

    expect(result.current.isOpened).toBe(true);
    expect(result.current.isSearchHistoryEnabled).toBe(false);
  });

  it('opens the search modal with search history enabled when isSearchHistoryEnabled is not specified', () => {
    const { result } = renderHook(() => useSearchModalStatus());
    renderSearchControl();

    fireEvent.click(screen.getByDisplayValue('foo'));

    expect(result.current.isOpened).toBe(true);
    expect(result.current.isSearchHistoryEnabled).toBe(true);
  });
});
