import type { IPageHasId } from '@growi/core';

import type { IActivityHasId } from '~/interfaces/activity';

import { PageListItemS } from '../PageList/PageListItemS';

// Define the component's props interface
type ActivityWithPageTarget = IActivityHasId & { target: IPageHasId };

export const ActivityListItem = ({ activity }: { activity: ActivityWithPageTarget }): JSX.Element => {

  const action = activity.action;
  const date = new Date(activity.createdAt).toLocaleString();


  return (
    <div className="activity-row">
      <p className="text-muted small mb-1">
        **{}** performed **{action}** on {date}
      </p>

      <PageListItemS page={activity.target} />
    </div>
  );
};
