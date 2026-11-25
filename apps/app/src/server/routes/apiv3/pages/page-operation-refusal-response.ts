import { ErrorV3 } from '@growi/core/dist/models';

import {
  PageOperationRefusalReason,
  PageOperationRefusedError,
} from '~/server/service/page/page-operation-refusal';

// The service's own message names paths and grants, so the response carries a fixed one.
const MESSAGE_BY_REASON: Record<PageOperationRefusalReason, string> = {
  [PageOperationRefusalReason.GRANT_NOT_ASSIGNABLE]:
    'The grant of the page is not assignable at the destination path.',
  [PageOperationRefusalReason.OPERATION_IN_PROGRESS]:
    'Another page operation is in progress on this path. Try again later.',
};

type RefusalResponse = { readonly error: ErrorV3; readonly status: number };

/**
 * @returns the response for a refusal, or null when `err` is an unexpected failure
 */
export const toPageOperationRefusalResponse = (
  err: unknown,
): RefusalResponse | null => {
  if (!(err instanceof PageOperationRefusedError)) {
    return null;
  }
  return {
    error: new ErrorV3(MESSAGE_BY_REASON[err.reason], err.reason),
    status: 409,
  };
};
