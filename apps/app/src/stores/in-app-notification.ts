import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { SupportedTargetModel } from '~/interfaces/activity';
import type {
  IInAppNotification,
  InAppNotificationStatuses,
  PaginateResult,
} from '~/interfaces/in-app-notification';
import * as userSerializers from '~/models/serializers/in-app-notification-snapshot/user';
import loggerFactory from '~/utils/logger';

import { apiv3Get } from '../client/util/apiv3-client';

const logger = loggerFactory('growi:cli:InAppNotification');

type inAppNotificationPaginateResult = PaginateResult<IInAppNotification>;

export const useSWRxInAppNotifications = (
  limit: number,
  offset?: number,
  status?: InAppNotificationStatuses,
  config?: SWRConfiguration,
): SWRResponse<PaginateResult<IInAppNotification>, Error> => {
  return useSWR(
    ['/in-app-notification/list', limit, offset, status],
    ([endpoint]) =>
      apiv3Get(endpoint, { limit, offset, status }).then((response) => {
        const inAppNotificationPaginateResult =
          response.data as inAppNotificationPaginateResult;
        inAppNotificationPaginateResult.docs.forEach((doc) => {
          try {
            if (doc.targetModel === SupportedTargetModel.MODEL_USER) {
              doc.parsedSnapshot = userSerializers.parseSnapshot(doc.snapshot);
            }
          } catch (err) {
            logger.warn('Failed to parse snapshot', err);
          }
        });
        return inAppNotificationPaginateResult;
      }),
    config,
  );
};

export const useSWRxInAppNotificationStatus = (): SWRResponse<
  number,
  Error
> => {
  return useSWR('/in-app-notification/status', (endpoint) =>
    apiv3Get(endpoint).then((response) => response.data.count),
  );
};

type InAppNotificationListKey =
  | [string, number, number, InAppNotificationStatuses | undefined]
  | null;

/**
 * SWRInfinite hook for paginated in-app notifications (for infinite scroll)
 */
export const useSWRINFxInAppNotifications = (
  limit: number,
  options?: { status?: InAppNotificationStatuses },
  config?: SWRConfiguration,
): SWRInfiniteResponse<PaginateResult<IInAppNotification>, Error> => {
  const status = options?.status;

  return useSWRInfinite<PaginateResult<IInAppNotification>, Error>(
    (pageIndex, previousPageData): InAppNotificationListKey => {
      if (previousPageData != null && !previousPageData.hasNextPage)
        return null;
      const offset = pageIndex * limit;
      return ['/in-app-notification/list', limit, offset, status];
    },
    ([endpoint, limit, offset, status]) =>
      apiv3Get(endpoint, { limit, offset, status }).then((response) => {
        const result = response.data as inAppNotificationPaginateResult;
        result.docs.forEach((doc) => {
          try {
            if (doc.targetModel === SupportedTargetModel.MODEL_USER) {
              doc.parsedSnapshot = userSerializers.parseSnapshot(doc.snapshot);
            }
          } catch (err) {
            logger.warn('Failed to parse snapshot', err);
          }
        });
        return result;
      }),
    {
      ...config,
      revalidateFirstPage: false,
    },
  );
};
