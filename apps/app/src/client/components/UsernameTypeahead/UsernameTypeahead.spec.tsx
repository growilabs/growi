import { createRef, useEffect, useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { IClearable } from '~/client/interfaces/clearable';

import { UsernameTypeahead } from './UsernameTypeahead';
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

/*
 * A source that resolves asynchronously, unlike `useFakeSuggestions` above.
 *
 * The real sources (SWR-backed) flip `isLoading` true and then false for each
 * new keyword, and that transition is precisely what makes `AsyncTypeahead`
 * record the keyword in its internal query cache. A source that answers
 * synchronously never arms that cache, so it cannot exercise a re-typed
 * keyword at all.
 */
const KNOWN_USERNAMES = ['admin'];

const searchedKeywords: string[] = [];

const useAsyncFakeSuggestions = (keyword: string): UsernameSuggestions => {
  const [resolved, setResolved] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (keyword === '' || keyword in resolved) {
      return;
    }
    searchedKeywords.push(keyword);

    // A microtask rather than a timer: what matters is only that the answer
    // lands in a later render, not how long it takes to get there.
    let isActive = true;
    Promise.resolve().then(() => {
      if (isActive) {
        setResolved((prev) => ({
          ...prev,
          [keyword]: KNOWN_USERNAMES.filter((name) => name.startsWith(keyword)),
        }));
      }
    });
    return () => {
      isActive = false;
    };
  }, [keyword, resolved]);

  const usernames = resolved[keyword];
  return {
    activeUsernames: usernames ?? [],
    inactiveUsernames: [],
    isLoading: keyword !== '' && usernames == null,
  };
};

const renderTypeahead = (initialUsernames?: string[]) =>
  render(
    <UsernameTypeahead
      onChange={vi.fn()}
      useUsernameSuggestions={useFakeSuggestions}
      initialUsernames={initialUsernames}
      placeholder="placeholder"
    />,
  );

describe('UsernameTypeahead', () => {
  beforeEach(() => {
    suggestions = EMPTY_SUGGESTIONS;
    searchedKeywords.length = 0;
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
      <UsernameTypeahead
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
      <UsernameTypeahead
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
      <UsernameTypeahead
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
      <UsernameTypeahead
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

    // The clear has to survive the next render, not just the moment after the
    // call: the inner typeahead re-syncs its selection from `selected` whenever
    // that prop disagrees with its state, so a clear that leaves our own
    // `selectedItems` populated puts the token back on the next keystroke.
    await userEvent.type(input, 'x');
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
  });

  // Awaited because `AsyncTypeahead` debounces `onSearch` by `delay` before the
  // keyword reaches the source.
  /**
   * Author/editor filters are typed into repeatedly — narrow the keyword, back
   * up, narrow again — so a keyword reaching the source only on its first
   * appearance leaves the menu permanently empty for every keyword the user has
   * already tried. `admd` in the middle matters: it is what moves the last
   * fetched keyword away from `adm`, so returning to `adm` has something stale
   * to be caught out by.
   */
  it('still suggests a username when its keyword is typed a second time', async () => {
    render(
      <UsernameTypeahead
        onChange={vi.fn()}
        useUsernameSuggestions={useAsyncFakeSuggestions}
        placeholder="placeholder"
      />,
    );
    const input = screen.getByRole('combobox');

    await userEvent.type(input, 'adm');
    expect(
      await screen.findByRole('option', { name: 'admin' }),
    ).toBeInTheDocument();

    // Waiting on the source call, not just on the menu emptying: the menu goes
    // empty the instant `admd` is typed, well before that keyword is searched
    // for, and backspacing from there would pass without ever exercising a
    // second visit to `adm`.
    await userEvent.type(input, 'd');
    await waitFor(() => {
      expect(searchedKeywords).toContain('admd');
    });
    // Positive control for the final assertion: it asserts the suggestion is
    // back, which only means something once the suggestion has actually gone
    // away. Without this the test could hold by `admin` never having left.
    expect(
      screen.queryByRole('option', { name: 'admin' }),
    ).not.toBeInTheDocument();

    await userEvent.type(input, '{backspace}');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'admin' })).toBeInTheDocument();
    });
  });

  it('queries the injected source with the typed keyword', async () => {
    const spy = vi.fn(() => EMPTY_SUGGESTIONS);

    render(
      <UsernameTypeahead
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
