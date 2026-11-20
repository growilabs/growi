type UsernameSuggestion = {
  username: string;
};

type ShouldShowUsernameSuggestionArgs = {
  option: UsernameSuggestion;
  currentText: string;
  fetchedForKeyword: string;
  selectedUsernames: string[];
};

/**
 * Decide whether a fetched suggestion should still be shown in the typeahead menu.
 *
 * `AsyncTypeahead`'s `delay` debounces when a new search actually fires, but the
 * input's raw text updates on every keystroke. Between those two moments, the
 * suggestion list still holds results fetched for the previous keyword. Hiding
 * everything while `currentText` and `fetchedForKeyword` disagree avoids flashing
 * suggestions that don't correspond to what the user is currently typing.
 */
export const shouldShowUsernameSuggestion = ({
  option,
  currentText,
  fetchedForKeyword,
  selectedUsernames,
}: ShouldShowUsernameSuggestionArgs): boolean => {
  if (currentText !== fetchedForKeyword) {
    return false;
  }
  return !selectedUsernames.includes(option.username);
};
