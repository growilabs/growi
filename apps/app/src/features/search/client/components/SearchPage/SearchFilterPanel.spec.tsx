import type { JSX, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

// Not under test here, and it owns an AsyncTypeahead of its own whose requests
// would muddy the endpoint assertions below.
vi.mock('~/client/components/PageTags/TagEditModal/TagsInput', () => ({
  TagsInput: () => <div data-testid="tags-input" />,
}));

const EMPTY_FILTERS: SearchFilterState = {
  authors: [],
  editors: [],
  groups: [],
  tags: [],
};

const AUDITLOG_SUGGESTIONS_ENDPOINT = '/activity/suggestions';
const REGISTERED_USERNAMES_ENDPOINT = '/users/usernames';

// Fresh SWR cache per render so cache keys never leak across tests. The
// suggestion hooks are `useSWRImmutable`, so a key cached by an earlier test
// would be served without ever calling the fetcher again.
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

// Author and editor both render a username typeahead; the tag input is mocked
// out, so these are the only comboboxes on the panel.
const typeIntoAuthorField = (text: string) =>
  userEvent.type(screen.getAllByRole('combobox')[0], text);

describe('SearchFilterPanel', () => {
  beforeEach(() => {
    mockApiv3Get.mockResolvedValue({ data: {} });
  });

  /**
   * This page is reachable by any logged-in user, but `/activity/suggestions` is
   * adminRequired — pointing the username filters at it makes suggestions 403 for
   * every non-admin (the regression this guards, see PR #11639). The assertion is
   * on the endpoint actually requested rather than on which hook was passed in, so
   * it survives any refactoring of how the source reaches the typeahead.
   */
  it('suggests usernames from the login-required endpoint, never the admin-only one', async () => {
    renderPanel();

    await typeIntoAuthorField('ali');

    // Wait for a suggestion request to actually happen first. Without this the
    // negative assertion below would pass vacuously, before the debounced
    // `onSearch` has fired at all.
    await waitFor(() => {
      expect(requestedEndpoints()).toContain(REGISTERED_USERNAMES_ENDPOINT);
    });

    expect(requestedEndpoints()).not.toContain(AUDITLOG_SUGGESTIONS_ENDPOINT);
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
});
