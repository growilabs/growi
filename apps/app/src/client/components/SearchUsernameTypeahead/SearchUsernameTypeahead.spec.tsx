import { createRef } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { IClearable } from '~/client/interfaces/clearable';

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

// Module-scope, so every render passes the same reference — the stability
// `UseUsernameSuggestions` requires.
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

  // The `t` mock echoes the key, so asserting the full key locks in the
  // namespace — which is the part that breaks (see CATEGORY_LABEL_KEYS).
  it('labels the groups with commons-namespaced keys, not hardcoded text', async () => {
    mockSuggestions(['alice'], ['bob']);

    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'a');

    const menu = await screen.findByRole('listbox');
    expect(
      within(menu).getByText('commons:username_suggestion.active_user'),
    ).toBeInTheDocument();
    expect(
      within(menu).getByText('commons:username_suggestion.inactive_user'),
    ).toBeInTheDocument();
  });

  // 2a leaves the search page with no inactive matches at all, so this is that
  // page's permanent state — an unconditional header would render over nothing.
  it('omits the inactive group header when no inactive users match', async () => {
    mockSuggestions(['alice'], []);

    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'a');

    const menu = await screen.findByRole('listbox');
    // Positive control: without it the absence assertions pass on an empty menu.
    expect(within(menu).getByText('alice')).toBeInTheDocument();
    expect(
      within(menu).getByText('commons:username_suggestion.active_user'),
    ).toBeInTheDocument();

    expect(
      within(menu).queryByText('commons:username_suggestion.inactive_user'),
    ).not.toBeInTheDocument();
    expect(within(menu).queryAllByRole('separator')).toHaveLength(0);
  });

  it('omits the active group header when only inactive users match', async () => {
    mockSuggestions([], ['bob']);

    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'b');

    const menu = await screen.findByRole('listbox');
    expect(within(menu).getByText('bob')).toBeInTheDocument();
    expect(
      within(menu).getByText('commons:username_suggestion.inactive_user'),
    ).toBeInTheDocument();

    expect(
      within(menu).queryByText('commons:username_suggestion.active_user'),
    ).not.toBeInTheDocument();
    // A divider above the first emitted group would be the `index`-only variant.
    expect(within(menu).queryAllByRole('separator')).toHaveLength(0);
  });

  // Order matters, not just presence: each username has to sit under its own
  // header, and the two groups have to be separated. Asserting the rendered
  // sequence covers both — membership alone would still pass with every option
  // piled under one header.
  it('renders active and inactive users under their respective headers, separated', async () => {
    mockSuggestions(['alice'], ['bob']);

    renderTypeahead();

    await userEvent.type(screen.getByRole('combobox'), 'a');

    const menu = await screen.findByRole('listbox');
    expect(menu.textContent).toMatch(
      /active_user[\s\S]*alice[\s\S]*inactive_user[\s\S]*bob/,
    );
    expect(within(menu).queryAllByRole('separator')).toHaveLength(1);
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

  // `AuditLogManagement`'s clear button drives the input through this ref
  // (`clearButtonPushedHandler` → `typeaheadRef.current?.clear()`), so the
  // handle reaching the inner typeahead is a contract, not an internal detail:
  // a plain function component inserted in between would make React drop the
  // ref silently, with no type error and no failing test elsewhere.
  it('empties the input when clear() is called on the forwarded ref', async () => {
    mockSuggestions(['alice']);
    const ref = createRef<IClearable>();

    render(
      <SearchUsernameTypeahead
        ref={ref}
        onChange={vi.fn()}
        useUsernameSuggestions={useFakeSuggestions}
        placeholder="placeholder"
      />,
    );

    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'alice');
    await userEvent.click(await screen.findByRole('option', { name: 'alice' }));
    expect(screen.getByText('alice')).toBeInTheDocument();

    act(() => {
      ref.current?.clear();
    });

    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  // Awaited because `AsyncTypeahead` debounces `onSearch` by `delay` before the
  // keyword reaches the source.
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
