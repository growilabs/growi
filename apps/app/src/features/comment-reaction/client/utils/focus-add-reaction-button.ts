const BAR_ATTRIBUTE = 'data-reaction-bar-comment-id';
const ADD_BUTTON_ATTRIBUTE = 'data-reaction-add-button';

export const reactionBarAttributes = (
  commentId: string,
): Record<string, string> => ({ [BAR_ATTRIBUTE]: commentId });

export const reactionAddButtonAttributes: Record<string, string> = {
  [ADD_BUTTON_ATTRIBUTE]: '',
};

/**
 * Moves focus to the add button at the end of the chip row of `commentId`, searching outward from
 * `origin` (the header row the add started in) so the same comment shown elsewhere is not picked.
 * Does nothing unless focus has fallen to `body` (its holder was removed): a user who has moved
 * focus elsewhere meanwhile is left alone.
 */
export const focusAddReactionButton = (
  commentId: string,
  origin: Element | null,
): void => {
  const active = document.activeElement;
  if (active != null && active !== document.body) {
    return;
  }
  for (let scope = origin; scope != null; scope = scope.parentElement) {
    const bar = Array.from(scope.querySelectorAll(`[${BAR_ATTRIBUTE}]`)).find(
      (candidate) => candidate.getAttribute(BAR_ATTRIBUTE) === commentId,
    );
    if (bar != null) {
      bar.querySelector<HTMLElement>(`[${ADD_BUTTON_ATTRIBUTE}]`)?.focus();
      return;
    }
  }
};
