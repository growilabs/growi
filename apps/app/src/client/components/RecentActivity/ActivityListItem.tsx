import { formatDistanceToNow } from 'date-fns';

import type { ActivityHasUserId, SupportedActivityActionType } from '~/interfaces/activity';
import { ActivityLogActions } from '~/interfaces/activity';

export const ActivityActionTranslationMap: Record<
  SupportedActivityActionType,
  string
> = {
  [ActivityLogActions.ACTION_PAGE_CREATE]: 'created a page',
  [ActivityLogActions.ACTION_PAGE_UPDATE]: 'updated a page',
  [ActivityLogActions.ACTION_PAGE_DELETE]: 'deleted a page',
  [ActivityLogActions.ACTION_PAGE_DELETE_COMPLETELY]: 'deleted a page',
  [ActivityLogActions.ACTION_PAGE_RENAME]: 'renamed a page',
  [ActivityLogActions.ACTION_PAGE_REVERT]: 'reverted a page',
  [ActivityLogActions.ACTION_PAGE_DUPLICATE]: 'duplicated a page',
  [ActivityLogActions.ACTION_PAGE_LIKE]: 'liked a page',
  [ActivityLogActions.ACTION_COMMENT_CREATE]: 'posted a comment',
};

export const IconActivityTranslationMap: Record<
  SupportedActivityActionType,
  string
> = {
  [ActivityLogActions.ACTION_PAGE_CREATE]: '➕',
  [ActivityLogActions.ACTION_PAGE_UPDATE]: '✏️',
  [ActivityLogActions.ACTION_PAGE_DELETE]: '🗑️',
  [ActivityLogActions.ACTION_PAGE_DELETE_COMPLETELY]: '❌',
  [ActivityLogActions.ACTION_PAGE_RENAME]: '🏷️',
  [ActivityLogActions.ACTION_PAGE_REVERT]: '⏪',
  [ActivityLogActions.ACTION_PAGE_DUPLICATE]: '📄📄',
  [ActivityLogActions.ACTION_PAGE_LIKE]: '❤️',
  [ActivityLogActions.ACTION_COMMENT_CREATE]: '💬',
};

const translateAction = (action: SupportedActivityActionType): string => {
  return ActivityActionTranslationMap[action] || 'performed an unknown action';
};

const setIcon = (action: SupportedActivityActionType): string => {
  return IconActivityTranslationMap[action] || 'performed an unknown action';
};

const calculateTimePassed = (date: Date): string => {
  const timePassed = formatDistanceToNow(date, { addSuffix: true });

  return timePassed;
};


export const ActivityListItem = ({ activity }: { activity: ActivityHasUserId }): JSX.Element => {
  const username = activity.user?.username;
  const action = activity.action as SupportedActivityActionType;

  return (
    <div className="activity-row">
      <p className="text-muted small mb-1">
        {setIcon(action)}

        <span className="text-gray-900 dark:text-white">
          {username}
        </span>

        <strong className="text-gray-900 dark:text-white">
          {' '}{translateAction(action)}
        </strong>

        <span className="text-muted text-xs">
          {' '}・{' '}
          {calculateTimePassed(activity.createdAt)}
        </span>
      </p>
    </div>
  );
};
