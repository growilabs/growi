import type { JSX, ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';

import type { SearchFilterState } from '~/features/search/utils/filter-fields';

import { SearchFilterPanel } from './SearchFilterPanel';

const mockApiv3Get = vi.hoisted(() => vi.fn());

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mockApiv3Get,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// Owns an AsyncTypeahead of its own, whose requests would muddy the endpoint
// assertions below.
vi.mock('~/client/components/PageTags/TagEditModal/TagsInput', () => ({
  TagsInput: () => <div data-testid="tags-input" />,
}));

const isGuestUser = vi.hoisted(() => ({ value: false }));

vi.mock('~/states/context', () => ({
  useIsGuestUser: () => isGuestUser.value,
}));

const EMPTY_FILTERS: SearchFilterState = {
  authors: [],
  editors: [],
  groups: [],
  tags: [],
};

const RELATED_GROUPS_ENDPOINT = '/user/related-groups';

// Fresh SWR cache per render: the suggestion hooks are `useSWRImmutable`, so a
// key cached by an earlier test is served without calling the fetcher again.
const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderPanel = () =>
  render(<SearchFilterPanel filters={EMPTY_FILTERS} onChange={vi.fn()} />, {
    wrapper,
  });

const requestedEndpoints = () =>
  mockApiv3Get.mock.calls.map(([endpoint]) => endpoint);

// Which endpoint the username fields hit is asserted next to the component that
// decides it (SearchUsernameTypeahead.spec.tsx), not here.
describe('SearchFilterPanel', () => {
  beforeEach(() => {
    mockApiv3Get.mockResolvedValue({ data: {} });
    isGuestUser.value = false;
  });

  describe('for a guest', () => {
    // The contract is that these controls are absent, not merely empty. Tag is
    // asserted present as a positive control, so the negative assertions cannot
    // pass by the whole panel having disappeared.
    it('renders no author, editor or group control', () => {
      isGuestUser.value = true;

      renderPanel();

      expect(screen.queryByText('Author')).not.toBeInTheDocument();
      expect(screen.queryByText('Editor')).not.toBeInTheDocument();
      expect(screen.queryByText('Group')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('combobox')).toHaveLength(0);
      expect(screen.getByText('Tag')).toBeInTheDocument();
    });

    // The group request fires on mount, so this catches "rendered the field but
    // emptied it" as well as "did not render it" — which the render assertions
    // above cannot distinguish.
    //
    // Only the group endpoint is asserted: the username suggestion request
    // fires on a keystroke, and a guest has no field to type into, so a
    // `not.toContain('/users/usernames')` here could never fail (verified by
    // rendering the username fields unconditionally — this test stayed green).
    // "No username field at all" is covered by the combobox count above.
    it('requests no user-group endpoint', async () => {
      // Logged-in render first, through the same settle procedure: proves the
      // request lands inside that window, so the guest assertion below cannot
      // pass by being checked too early.
      const { unmount } = renderPanel();
      await act(async () => {});
      expect(requestedEndpoints()).toContain(RELATED_GROUPS_ENDPOINT);

      unmount();
      mockApiv3Get.mockClear();
      isGuestUser.value = true;
      renderPanel();
      await act(async () => {});

      expect(requestedEndpoints()).not.toContain(RELATED_GROUPS_ENDPOINT);
    });
  });
});
