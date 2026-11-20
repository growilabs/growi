import { shouldShowUsernameSuggestion } from './should-show-username-suggestion';

describe('shouldShowUsernameSuggestion', () => {
  it('hides the suggestion while a newer keystroke is awaiting its debounced search', () => {
    const result = shouldShowUsernameSuggestion({
      option: { username: 'alice' },
      currentText: 'ali',
      fetchedForKeyword: 'al',
      selectedUsernames: [],
    });

    expect(result).toBe(false);
  });

  it('shows an unselected suggestion once fetched results match the current text', () => {
    const result = shouldShowUsernameSuggestion({
      option: { username: 'alice' },
      currentText: 'ali',
      fetchedForKeyword: 'ali',
      selectedUsernames: [],
    });

    expect(result).toBe(true);
  });

  it('hides a suggestion that is already selected, even when results are fresh', () => {
    const result = shouldShowUsernameSuggestion({
      option: { username: 'alice' },
      currentText: 'ali',
      fetchedForKeyword: 'ali',
      selectedUsernames: ['alice'],
    });

    expect(result).toBe(false);
  });
});
