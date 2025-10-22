import type { ActivityWithPageTarget } from '~/interfaces/activity';

import { PageListItemS } from '../PageList/PageListItemS';


export const ActivityListItem = ({ activity }: { activity: ActivityWithPageTarget }): JSX.Element => {

  const username = activity.user?.username.trim();
  const action = activity.action;
  const date = new Date(activity.createdAt).toLocaleString();


  return (
    <div className="activity-row">
      <p className="text-muted small mb-1">
        {username} performed {action} on {date}
      </p>

      <PageListItemS page={activity.target} />
    </div>
  );
};
