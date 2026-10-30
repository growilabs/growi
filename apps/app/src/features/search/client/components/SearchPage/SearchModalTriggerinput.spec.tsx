import { fireEvent, render, renderHook, screen } from '@testing-library/react';

import { useSearchModalStatus } from '../../states/modal/search';
import { SearchModalTriggerinput } from './SearchModalTriggerinput';

describe('SearchModalTriggerinput', () => {
  it('opens the modal with search history enabled by default', () => {
    const { result } = renderHook(() => useSearchModalStatus());
    render(<SearchModalTriggerinput keywordOnInit="foo" />);

    fireEvent.click(screen.getByDisplayValue('foo'));

    expect(result.current.isOpened).toBe(true);
    expect(result.current.isSearchHistoryEnabled).toBe(true);
  });

  it('opens the modal with search history disabled when isSearchHistoryEnabled is false', () => {
    const { result } = renderHook(() => useSearchModalStatus());
    render(
      <SearchModalTriggerinput
        keywordOnInit="/"
        isSearchHistoryEnabled={false}
      />,
    );

    fireEvent.click(screen.getByDisplayValue('/'));

    expect(result.current.isOpened).toBe(true);
    expect(result.current.isSearchHistoryEnabled).toBe(false);
  });
});
