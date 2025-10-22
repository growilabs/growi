import { ActivityActionTranslationMap } from '~/interfaces/activity';
import type { ActivityWithPageTarget, SupportedActivityActionType } from '~/interfaces/activity';

import { PageListItemS } from '../PageList/PageListItemS';

const translateAction = (action: SupportedActivityActionType): string => {
  return ActivityActionTranslationMap[action] || 'performed an unknown action';
};


export const ActivityListItem = ({ activity }: { activity: ActivityWithPageTarget }): JSX.Element => {
  const username = activity.user?.username;
  const action = activity.action as SupportedActivityActionType;
  const date = new Date(activity.createdAt).toLocaleString();

  return (
    <div className="activity-row">
      <p className="text-muted small mb-1">
        {username} {translateAction(action)} on {date}
      </p>

      <PageListItemS page={activity.target} />
    </div>
  );
};
