import type { ISearchFilter, SupportedActionType } from '~/interfaces/activity';

type BuildActivitySearchFilterArgs = {
  selectedActions: SupportedActionType[];
  availableActions: SupportedActionType[];
  dates: ISearchFilter['dates'];
  usernames: string[];
};

/**
 * Build the audit-log list search filter, omitting `actions` when every
 * available action is selected.
 *
 * The server treats an absent `actions` filter as "match every activity", so
 * sending the full action list adds nothing but weight. Historically that list
 * was serialized into the GET query string and, for large action-group configs
 * (~145 actions), pushed the URL past common proxy header limits. `actions` is
 * therefore sent only when the selection is a strict subset; the all-selected
 * default (and the "clear" reset) omit it entirely.
 */
export const buildActivitySearchFilter = ({
  selectedActions,
  availableActions,
  dates,
  usernames,
}: BuildActivitySearchFilterArgs): ISearchFilter => {
  const filter: ISearchFilter = { usernames, dates };

  const selectedSet = new Set<SupportedActionType>(selectedActions);
  const isAllSelected =
    availableActions.length > 0 &&
    availableActions.every((action) => selectedSet.has(action));

  if (!isAllSelected) {
    filter.actions = selectedActions;
  }

  return filter;
};
