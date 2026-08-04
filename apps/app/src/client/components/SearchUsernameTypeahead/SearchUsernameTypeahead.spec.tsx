import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';

const mockUseSWRxAuditlogSuggestions = vi.hoisted(() => vi.fn());

vi.mock('~/stores/activity', () => ({
  useSWRxAuditlogSuggestions: mockUseSWRxAuditlogSuggestions,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockSuggestions = (
  activeUsernames: string[],
  inactiveUsernames: string[] = [],
) => {
  mockUseSWRxAuditlogSuggestions.mockReturnValue({
    data: { username: { activeUsernames, inactiveUsernames } },
    error: undefined,
    isLoading: false,
  });
};

const renderTypeahead = (initialUsernames?: string[]) =>
  render(
    <SearchUsernameTypeahead
      onChange={vi.fn()}
      initialUsernames={initialUsernames}
      placeholder="placeholder"
    />,
  );

describe('SearchUsernameTypeahead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggestions([]);
  });

  it('renders active and inactive users in correct groups', async () => {
    mockSuggestions(['alice'], ['bob']);

    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'a');

    const menu = await screen.findByRole('listbox');
    expect(within(menu).getByText('Active User')).toBeInTheDocument();
    expect(within(menu).getByText('alice')).toBeInTheDocument();
    expect(within(menu).getByText('Inactive User')).toBeInTheDocument();
    expect(within(menu).getByText('bob')).toBeInTheDocument();
  });

  it('filters out already-selected usernames from the suggestion menu', async () => {
    mockSuggestions(['alice', 'bob']);

    renderTypeahead(['alice']);

    await userEvent.type(screen.getByRole('combobox'), 'b');

    const menu = await screen.findByRole('listbox');
    expect(within(menu).getByText('bob')).toBeInTheDocument();
    expect(within(menu).queryByText('alice')).not.toBeInTheDocument();
  });

  it('renders no options when response has no username data', async () => {
    mockUseSWRxAuditlogSuggestions.mockReturnValue({
      data: {},
      error: undefined,
      isLoading: false,
    });

    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'a');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders the initial usernames as tokens', () => {
    const { getByText } = renderTypeahead(['alice', 'bob']);

    expect(getByText('alice')).toBeInTheDocument();
    expect(getByText('bob')).toBeInTheDocument();
  });

  // Contract the author/editor chips-bar clear and URL rehydrate rely on: an
  // external change to `initialUsernames` must be reflected in the shown tokens.
  // The seed-only `useState` initializer ignored post-mount changes; the guarded
  // sync effect is what makes this hold.
  it('reflects an external initialUsernames change into the rendered tokens', () => {
    const { getByText, queryByText, rerender } = renderTypeahead([
      'alice',
      'bob',
    ]);
    expect(getByText('alice')).toBeInTheDocument();

    rerender(
      <SearchUsernameTypeahead
        onChange={vi.fn()}
        initialUsernames={['carol']}
        placeholder="placeholder"
      />,
    );

    expect(getByText('carol')).toBeInTheDocument();
    expect(queryByText('alice')).not.toBeInTheDocument();
    expect(queryByText('bob')).not.toBeInTheDocument();
  });

  // Mirrors removing a single chip from the filter bar (remove one, keep the
  // rest) — a distinct path from the full-replace and clear-all cases.
  it('removes only the deselected username on a partial change', () => {
    const { getByText, queryByText, rerender } = renderTypeahead([
      'alice',
      'bob',
    ]);
    expect(getByText('alice')).toBeInTheDocument();
    expect(getByText('bob')).toBeInTheDocument();

    rerender(
      <SearchUsernameTypeahead
        onChange={vi.fn()}
        initialUsernames={['bob']}
        placeholder="placeholder"
      />,
    );

    expect(queryByText('alice')).not.toBeInTheDocument();
    expect(getByText('bob')).toBeInTheDocument();
  });

  it('clears all tokens when initialUsernames is reset to empty', () => {
    const { getByText, queryByText, rerender } = renderTypeahead(['alice']);
    expect(getByText('alice')).toBeInTheDocument();

    rerender(
      <SearchUsernameTypeahead
        onChange={vi.fn()}
        initialUsernames={[]}
        placeholder="placeholder"
      />,
    );

    expect(queryByText('alice')).not.toBeInTheDocument();
  });
});
