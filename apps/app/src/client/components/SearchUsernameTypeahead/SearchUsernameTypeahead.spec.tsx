import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';
import type { UsernameSuggestions } from './username-suggestions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const EMPTY_SUGGESTIONS: UsernameSuggestions = {
  activeUsernames: [],
  inactiveUsernames: [],
  isLoading: false,
};

let suggestions: UsernameSuggestions = EMPTY_SUGGESTIONS;

// A module-scope function, so every render passes the same reference — the
// stability the `UseUsernameSuggestions` contract requires.
const useFakeSuggestions = () => suggestions;

const mockSuggestions = (
  activeUsernames: string[],
  inactiveUsernames: string[] = [],
) => {
  suggestions = { activeUsernames, inactiveUsernames, isLoading: false };
};

const renderTypeahead = (initialUsernames?: string[]) =>
  render(
    <SearchUsernameTypeahead
      onChange={vi.fn()}
      useUsernameSuggestions={useFakeSuggestions}
      initialUsernames={initialUsernames}
      placeholder="placeholder"
    />,
  );

describe('SearchUsernameTypeahead', () => {
  beforeEach(() => {
    suggestions = EMPTY_SUGGESTIONS;
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

  it('renders no options when the source returns no usernames', async () => {
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
        useUsernameSuggestions={useFakeSuggestions}
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
        useUsernameSuggestions={useFakeSuggestions}
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
        useUsernameSuggestions={useFakeSuggestions}
        initialUsernames={[]}
        placeholder="placeholder"
      />,
    );

    expect(queryByText('alice')).not.toBeInTheDocument();
  });

  // The point of injecting the source: whichever one a caller supplies has to
  // receive the typed keyword. Awaited because `AsyncTypeahead` debounces
  // `onSearch` by `delay` before the keyword reaches the source.
  it('queries the injected source with the typed keyword', async () => {
    const spy = vi.fn(() => EMPTY_SUGGESTIONS);

    render(
      <SearchUsernameTypeahead
        onChange={vi.fn()}
        useUsernameSuggestions={spy}
        placeholder="placeholder"
      />,
    );

    await userEvent.type(screen.getByRole('combobox'), 'ali');

    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith('ali');
    });
  });
});
