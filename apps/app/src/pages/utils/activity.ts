import type { GetServerSidePropsContext } from 'next';

import type { SupportedActionType } from '~/interfaces/activity';
import type { CrowiRequest } from '~/interfaces/crowi-request';

export const addActivity = async (
  context: GetServerSidePropsContext,
  action: SupportedActionType,
): Promise<void> => {
  const req = context.req as CrowiRequest;

  const parameters = {
    ip: req.ip,
    endpoint: req.originalUrl,
    action,
    user: req.user?._id,
    snapshot: {
      username: req.user?.username,
    },
  };

  await req.crowi.activityService.createActivity(parameters);
};
