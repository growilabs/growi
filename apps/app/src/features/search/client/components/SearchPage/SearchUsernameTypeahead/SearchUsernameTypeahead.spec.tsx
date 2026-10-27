import type { JSX, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';

import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';

const mockApiv3Get = vi.hoisted(() => vi.fn());

vi.mock('~/client/util/apiv3-client', () => ({
  apiv3Get: mockApiv3Get,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const AUDITLOG_SUGGESTIONS_ENDPOINT = '/activity/suggestions';
const REGISTERED_USERNAMES_ENDPOINT = '/users/usernames';

// Fresh SWR cache per render: the suggestion hook is `useSWRImmutable`, so a
// key cached by an earlier test is served without calling the fetcher again.
const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    {children}
  </SWRConfig>
);

const renderTypeahead = () =>
  render(<SearchUsernameTypeahead onChange={vi.fn()} placeholder="author" />, {
    wrapper,
  });

const requestedEndpoints = () =>
  mockApiv3Get.mock.calls.map(([endpoint]) => endpoint);

describe('SearchUsernameTypeahead', () => {
  beforeEach(() => {
    mockApiv3Get.mockResolvedValue({ data: {} });
  });

  /**
   * Guards the 403 regression: the search page is open to any logged-in user,
   * but `/activity/suggestions` is adminRequired. Asserted on the endpoint
   * actually requested rather than on which hook this component passes down, so
   * it survives any refactoring of how the source reaches the typeahead.
   */
  it('suggests usernames from the login-required endpoint, never the admin-only one', async () => {
    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'ali');

    // Without waiting for a request to land, the negative assertion below passes
    // vacuously — before the debounced `onSearch` has fired at all.
    await waitFor(() => {
      expect(requestedEndpoints()).toContain(REGISTERED_USERNAMES_ENDPOINT);
    });

    expect(requestedEndpoints()).not.toContain(AUDITLOG_SUGGESTIONS_ENDPOINT);
  });

  /**
   * Suspended / invited accounts are admin-only on the server, and this page is
   * open to any visitor on a guest-readable wiki. Asserted on `!== true` rather
   * than `=== false`, so omitting the option entirely — the equivalent request
   * — still passes.
   */
  it('does not ask the suggestion endpoint for inactive users', async () => {
    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'ali');

    await waitFor(() => {
      expect(requestedEndpoints()).toContain(REGISTERED_USERNAMES_ENDPOINT);
    });

    const suggestionCalls = mockApiv3Get.mock.calls.filter(
      ([endpoint]) => endpoint === REGISTERED_USERNAMES_ENDPOINT,
    );
    expect(suggestionCalls.length).toBeGreaterThan(0);
    for (const [, params] of suggestionCalls) {
      expect(JSON.parse(params.options).isIncludeInactiveUser).not.toBe(true);
    }
  });

  it('sends the typed keyword to the suggestion request', async () => {
    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'ali');

    await waitFor(() => {
      expect(mockApiv3Get).toHaveBeenCalledWith(
        REGISTERED_USERNAMES_ENDPOINT,
        expect.objectContaining({ q: 'ali' }),
      );
    });
  });

  /**
   * The page renders this twice (author and editor). The typeahead derives each
   * option's DOM id from this prop (`{id}-item-N`), and the input points at the
   * active option through it — so two fields sharing an id would have keyboard
   * and screen-reader focus land on the *other* field's options.
   *
   * Asserted on an option's id rather than the input's, because that is where
   * the prop actually surfaces — and on the prefix only, because the `-item-N`
   * suffix is react-bootstrap-typeahead's own scheme. A dropped `id` still
   * fails this (the option would be prefixed with the component's fallback id),
   * while a library upgrade that renames the suffix does not.
   */
  it('derives the option ids from the caller-supplied id', async () => {
    const id = 'author-field';
    mockApiv3Get.mockResolvedValue({
      data: { activeUser: { usernames: ['alice'] } },
    });

    render(
      <SearchUsernameTypeahead
        id={id}
        onChange={vi.fn()}
        placeholder="author"
      />,
      { wrapper },
    );

    await userEvent.type(screen.getByRole('combobox'), 'ali');

    const option = await screen.findByRole('option', { name: 'alice' });
    expect(option.id.startsWith(id)).toBe(true);
  });
});
