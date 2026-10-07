import { PageGrant } from '@growi/core';
import { act, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

import { useCurrentPageId } from '~/states/page';
import { useSWRxCurrentGrantData } from '~/stores/page';

import { useSelectedGrant } from './selected-grant';
import { useSyncSelectedGrantWithCurrentPage } from './use-sync-selected-grant';

vi.mock('~/states/page', () => ({ useCurrentPageId: vi.fn() }));
vi.mock('~/stores/page', () => ({ useSWRxCurrentGrantData: vi.fn() }));

const mockedUseCurrentPageId = vi.mocked(useCurrentPageId);
const mockedUseSWRxCurrentGrantData = vi.mocked(useSWRxCurrentGrantData);

// Build a plain SWR response. vitest-mock-extended's mock<SWRResponse>() cannot be
// used here: its deep proxy auto-stubs `.then`, so React treats `data` as a thenable
// and breaks rendering. A plain object with a single localized cast is the repo norm
// (see states/page/use-fetch-current-page.spec.tsx).
const grantDataResponse = (currentPageGrant?: {
  grant: PageGrant;
}): ReturnType<typeof useSWRxCurrentGrantData> =>
  ({
    data:
      currentPageGrant == null
        ? undefined
        : {
            isGrantNormalized: true,
            grantData: { isForbidden: false, currentPageGrant },
          },
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  }) as ReturnType<typeof useSWRxCurrentGrantData>;

describe('useSyncSelectedGrantWithCurrentPage', () => {
  let store: ReturnType<typeof createStore>;

  // Render the consumer's view (useSelectedGrant) alongside the sync hook so we
  // assert on the observable atom value, not on the setter being called.
  const renderSyncHook = () =>
    renderHook(
      () => {
        const selected = useSelectedGrant();
        useSyncSelectedGrantWithCurrentPage();
        return selected;
      },
      {
        wrapper: ({ children }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );

  beforeEach(() => {
    store = createStore();
    mockedUseCurrentPageId.mockReturnValue('page1');
  });

  it("initializes selectedGrant from the current page's grant", () => {
    mockedUseSWRxCurrentGrantData.mockReturnValue(
      grantDataResponse({ grant: PageGrant.GRANT_OWNER }),
    );

    // renderHook flushes mount effects in its internal act(), so the sync has
    // already applied by the time it returns.
    const { result } = renderSyncHook();

    expect(result.current[0]).toEqual({
      grant: PageGrant.GRANT_OWNER,
      userRelatedGrantedGroups: [],
    });
  });

  it('does not overwrite an existing selection while grant data is unavailable', () => {
    mockedUseSWRxCurrentGrantData.mockReturnValue(grantDataResponse());

    const { result } = renderSyncHook();

    act(() => {
      result.current[1]({ grant: PageGrant.GRANT_RESTRICTED });
    });

    // The sync effect re-runs on the update but must leave the selection intact
    // because there is no grant data to apply yet.
    expect(result.current[0]).toEqual({ grant: PageGrant.GRANT_RESTRICTED });
  });
});
