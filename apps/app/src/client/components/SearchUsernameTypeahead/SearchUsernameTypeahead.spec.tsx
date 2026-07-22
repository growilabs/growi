import { render } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('~/stores/user', () => ({
  useSWRxUsernames: () => ({ data: undefined, error: null, isLoading: false }),
}));

import { SearchUsernameTypeahead } from './SearchUsernameTypeahead';

const renderTypeahead = (initialUsernames?: string[]) =>
  render(
    <SearchUsernameTypeahead
      onChange={vi.fn()}
      initialUsernames={initialUsernames}
      placeholder="placeholder"
    />,
  );

describe('SearchUsernameTypeahead', () => {
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
