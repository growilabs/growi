import { act, renderHook } from '@testing-library/react';

import { useSearchModalActions, useSearchModalStatus } from './search';

const renderModalHooks = () =>
  renderHook(() => ({
    status: useSearchModalStatus(),
    actions: useSearchModalActions(),
  }));

describe('search modal state', () => {
  it('enables search history by default when opened', () => {
    const { result } = renderModalHooks();

    act(() => result.current.actions.open('keyword'));

    expect(result.current.status.isOpened).toBe(true);
    expect(result.current.status.searchKeyword).toBe('keyword');
    expect(result.current.status.isSearchHistoryEnabled).toBe(true);
  });

  it('disables search history when opened with isSearchHistoryEnabled: false', () => {
    const { result } = renderModalHooks();

    act(() =>
      result.current.actions.open('/', undefined, {
        isSearchHistoryEnabled: false,
      }),
    );

    expect(result.current.status.isSearchHistoryEnabled).toBe(false);
  });

  it('enables search history again after the modal is closed', () => {
    const { result } = renderModalHooks();

    act(() =>
      result.current.actions.open('/', undefined, {
        isSearchHistoryEnabled: false,
      }),
    );
    act(() => result.current.actions.close());

    expect(result.current.status.isOpened).toBe(false);
    expect(result.current.status.isSearchHistoryEnabled).toBe(true);
  });

  it('keeps the search override passed on open', () => {
    const { result } = renderModalHooks();
    const onSearchOverride = vi.fn();

    act(() => result.current.actions.open('kw', onSearchOverride));

    expect(result.current.status.onSearchOverride).toBe(onSearchOverride);
    expect(result.current.status.isSearchHistoryEnabled).toBe(true);
  });
});
