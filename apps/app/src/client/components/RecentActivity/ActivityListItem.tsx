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

const translateAction = (action: SupportedActivityActionType): string => {
  return ActivityActionTranslationMap[action] || 'performed an unknown action';
};


export const ActivityListItem = ({ activity }: { activity: ActivityHasUserId }): JSX.Element => {
  const username = activity.user?.username;
  const action = activity.action as SupportedActivityActionType;
  const date = new Date(activity.createdAt).toLocaleString();

  return (
    <div className="activity-row">
      <p className="text-muted small mb-1">
        {username} {translateAction(action)} on {date}
      </p>
    </div>
  );
};
