import type { ReactNode } from 'react';
import { PageGrant } from '@growi/core';
import { act, render, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

import type { IPageSelectedGrant } from '~/interfaces/page';
import { useSelectedGrant } from '~/states/ui/editor';

import { GrantSelector } from './GrantSelector';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('~/states/global', () => ({ useCurrentUser: vi.fn(() => undefined) }));
vi.mock('~/states/page', () => ({ useCurrentPageId: vi.fn(() => 'page1') }));
vi.mock('~/stores/page', () => ({
  useSWRxCurrentGrantData: vi.fn(() => ({ data: undefined })),
}));

const renderGrantSelector = (
  seed?: (set: (grant: IPageSelectedGrant | null) => void) => void,
) => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );

  if (seed != null) {
    const { result } = renderHook(() => useSelectedGrant(), { wrapper });
    act(() => seed(result.current[1]));
  }

  return render(<GrantSelector />, { wrapper });
};

describe('GrantSelector', () => {
  // Before the current page's grant is loaded, selectedGrant is null. Showing the
  // default "Public" option would mislead the user; show a loading state instead.
  // See: https://github.com/growilabs/growi/issues/11272
  it('shows a loading state while the grant is not yet resolved (null)', () => {
    const { queryByTestId } = renderGrantSelector();

    expect(queryByTestId('grw-grant-selector-loading')).not.toBeNull();
    // ...and the selector dropdown is not shown yet (no misleading "Public").
    expect(queryByTestId('grw-grant-selector-dropdown-menu')).toBeNull();
  });

  it('shows the grant selector once the grant is available', () => {
    const { queryByTestId } = renderGrantSelector((set) =>
      set({ grant: PageGrant.GRANT_OWNER }),
    );

    expect(queryByTestId('grw-grant-selector-loading')).toBeNull();
    expect(queryByTestId('grw-grant-selector-dropdown-menu')).not.toBeNull();
  });
});
