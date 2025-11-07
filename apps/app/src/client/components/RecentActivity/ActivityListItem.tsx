import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'next-i18next';

import type { ActivityHasUserId, SupportedActivityActionType } from '~/interfaces/activity';
import { ActivityLogActions } from '~/interfaces/activity';


export const ActivityActionTranslationMap: Record<
  SupportedActivityActionType,
  string
> = {
  [ActivityLogActions.ACTION_PAGE_CREATE]: 'page_create',
  [ActivityLogActions.ACTION_PAGE_UPDATE]: 'page_update',
  [ActivityLogActions.ACTION_PAGE_DELETE]: 'page_delete',
  [ActivityLogActions.ACTION_PAGE_DELETE_COMPLETELY]: 'page_delete_completely',
  [ActivityLogActions.ACTION_PAGE_RENAME]: 'page_rename',
  [ActivityLogActions.ACTION_PAGE_REVERT]: 'page_revert',
  [ActivityLogActions.ACTION_PAGE_DUPLICATE]: 'page_duplicate',
  [ActivityLogActions.ACTION_PAGE_LIKE]: 'page_like',
  [ActivityLogActions.ACTION_COMMENT_CREATE]: 'comment_create',
};

export const IconActivityTranslationMap: Record<
  SupportedActivityActionType,
  string
> = {
  [ActivityLogActions.ACTION_PAGE_CREATE]: 'add_box',
  [ActivityLogActions.ACTION_PAGE_UPDATE]: 'edit',
  [ActivityLogActions.ACTION_PAGE_DELETE]: 'delete',
  [ActivityLogActions.ACTION_PAGE_DELETE_COMPLETELY]: 'delete_forever',
  [ActivityLogActions.ACTION_PAGE_RENAME]: 'label',
  [ActivityLogActions.ACTION_PAGE_REVERT]: 'undo',
  [ActivityLogActions.ACTION_PAGE_DUPLICATE]: 'content_copy',
  [ActivityLogActions.ACTION_PAGE_LIKE]: 'favorite',
  [ActivityLogActions.ACTION_COMMENT_CREATE]: 'comment',
};

const translateAction = (action: SupportedActivityActionType): string => {
  return ActivityActionTranslationMap[action] || 'unknown_action';
};

const setIcon = (action: SupportedActivityActionType): string => {
  return IconActivityTranslationMap[action] || '';
};

const calculateTimePassed = (date: Date): string => {
  const timePassed = formatDistanceToNow(date, { addSuffix: true });

  return timePassed;
};


export const ActivityListItem = ({ activity }: { activity: ActivityHasUserId }): JSX.Element => {
  const { t } = useTranslation();

  const action = activity.action as SupportedActivityActionType;
  const keyToTranslate = translateAction(action);
  const fullKeyPath = `user_home_page.${keyToTranslate}`;

  return (
    <div className="activity-row">
      <p className="small mb-1">
        {setIcon(action)}

        <strong className="text-gray-900 dark:text-white">
          {' '}{t(fullKeyPath)}
        </strong>

        <span className="text-secondary">
          {' '}・{' '}
          {calculateTimePassed(activity.createdAt)}
        </span>
      </p>
    </div>
  );
};
