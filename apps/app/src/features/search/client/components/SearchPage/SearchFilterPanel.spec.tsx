import type { JSX, ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const AUDITLOG_SUGGESTIONS_ENDPOINT = '/activity/suggestions';
const REGISTERED_USERNAMES_ENDPOINT = '/users/usernames';
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

// Author and editor both render a username typeahead; author is first.
const typeIntoAuthorField = (text: string) =>
  userEvent.type(screen.getAllByRole('combobox')[0], text);

describe('SearchFilterPanel', () => {
  beforeEach(() => {
    mockApiv3Get.mockResolvedValue({ data: {} });
    isGuestUser.value = false;
  });

  /**
   * Guards the 403 regression: this page is open to any logged-in user, but
   * `/activity/suggestions` is adminRequired. Asserted on the endpoint actually
   * requested, not on which hook was passed, so it survives refactoring of how
   * the source reaches the typeahead.
   */
  it('suggests usernames from the login-required endpoint, never the admin-only one', async () => {
    renderPanel();

    await typeIntoAuthorField('ali');

    // Without waiting for a request to land, the negative assertion below passes
    // vacuously — before the debounced `onSearch` has fired at all.
    await waitFor(() => {
      expect(requestedEndpoints()).toContain(REGISTERED_USERNAMES_ENDPOINT);
    });

    expect(requestedEndpoints()).not.toContain(AUDITLOG_SUGGESTIONS_ENDPOINT);
  });

  /**
   * Suspended / invited accounts are admin-only on the server, and this page is
   * open to any visitor on a guest-readable wiki. Asserted on the request the
   * page actually issues, and on `!== true` rather than `=== false`, so omitting
   * the option entirely — the equivalent request — still passes.
   */
  it('does not ask the suggestion endpoint for inactive users', async () => {
    renderPanel();

    await typeIntoAuthorField('ali');

    await waitFor(() => {
      expect(requestedEndpoints()).toContain(REGISTERED_USERNAMES_ENDPOINT);
    });

    // The panel also requests unrelated endpoints (user groups), which carry no
    // `options` param.
    const suggestionCalls = mockApiv3Get.mock.calls.filter(
      ([endpoint]) => endpoint === REGISTERED_USERNAMES_ENDPOINT,
    );
    expect(suggestionCalls.length).toBeGreaterThan(0);
    for (const [, params] of suggestionCalls) {
      expect(JSON.parse(params.options).isIncludeInactiveUser).not.toBe(true);
    }
  });

  it('sends the typed keyword to the suggestion request', async () => {
    renderPanel();

    await typeIntoAuthorField('ali');

    await waitFor(() => {
      expect(mockApiv3Get).toHaveBeenCalledWith(
        REGISTERED_USERNAMES_ENDPOINT,
        expect.objectContaining({ q: 'ali' }),
      );
    });
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

    // The group request fires on mount, so it catches "rendered the field but
    // emptied it" as well as "did not render it".
    it('requests no login-required endpoint', async () => {
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
      expect(requestedEndpoints()).not.toContain(REGISTERED_USERNAMES_ENDPOINT);
    });
  });
});
