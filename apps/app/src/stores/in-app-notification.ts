import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { SupportedTargetModel } from '~/interfaces/activity';
import type {
  IInAppNotificationHasId,
  InAppNotificationStatuses,
  PaginateResult,
} from '~/interfaces/in-app-notification';
import * as userSerializers from '~/models/serializers/in-app-notification-snapshot/user';
import loggerFactory from '~/utils/logger';

import { apiv3Get } from '../client/util/apiv3-client';

const logger = loggerFactory('growi:cli:InAppNotification');

type InAppNotificationPaginateResult = PaginateResult<IInAppNotificationHasId>;

export const useSWRxInAppNotifications = (
  limit: number,
  offset?: number,
  status?: InAppNotificationStatuses,
  config?: SWRConfiguration,
): SWRResponse<InAppNotificationPaginateResult, Error> => {
  return useSWR(
    ['/in-app-notification/list', limit, offset, status],
    ([endpoint]) =>
      apiv3Get<InAppNotificationPaginateResult>(endpoint, {
        limit,
        offset,
        status,
      }).then((response) => {
        const result = response.data;
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
    config,
  );
};

export const useSWRxInAppNotificationStatus = (): SWRResponse<
  number,
  Error
> => {
  return useSWR('/in-app-notification/status', (endpoint) =>
    apiv3Get<{ count: number }>(endpoint).then(
      (response) => response.data.count,
    ),
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
): SWRInfiniteResponse<InAppNotificationPaginateResult, Error> => {
  const status = options?.status;

  return useSWRInfinite<InAppNotificationPaginateResult, Error>(
    (pageIndex, previousPageData): InAppNotificationListKey => {
      if (previousPageData != null && !previousPageData.hasNextPage)
        return null;
      const offset = pageIndex * limit;
      return ['/in-app-notification/list', limit, offset, status];
    },
    ([endpoint, limit, offset, status]) =>
      apiv3Get<InAppNotificationPaginateResult>(endpoint, {
        limit,
        offset,
        status,
      }).then((response) => {
        const result = response.data;
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
