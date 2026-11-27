import { isErrorV3 } from '@growi/core/dist/models';
import { mutate } from 'swr';

import { apiv3Post } from '~/client/util/apiv3-client';
import { mutateRecentlyUpdated } from '~/stores/page-listing';

import type { RevertRequestBody, RevertResult } from '../../../interfaces';
import { REVERT_REQUEST_ERROR_CODES } from '../../../interfaces';
import { getChangeProposalDetailKey } from './use-swrx-change-proposal';
import { mutateAllRevisionMarks } from './use-swrx-revision-marks';

export type RevertActionResult =
  | { readonly type: 'done'; readonly result: RevertResult }
  | { readonly type: 'not-found' }
  | { readonly type: 'error' };

export type RevertRequestResult =
  | { readonly type: 'sent' }
  | {
      readonly type: 'error';
      readonly code:
        | 'not-found'
        | 'message-too-long'
        | 'recently-requested'
        | 'own-proposal'
        | 'requester-unavailable'
        | 'unknown';
    };

const API_CODE_NOT_FOUND = 'notfound';
const API_CODE_VALIDATION = 'validation_failed';

// apiv3Post rejects with the response's `errors` array, not an Error, and drops the HTTP status.
const extractErrorCodes = (err: unknown): readonly string[] =>
  Array.isArray(err)
    ? err.filter((item) => isErrorV3(item)).map((item) => item.code)
    : [];

const REQUEST_ERROR_CODES: ReadonlyArray<
  readonly [string, Extract<RevertRequestResult, { type: 'error' }>['code']]
> = [
  [API_CODE_NOT_FOUND, 'not-found'],
  [API_CODE_VALIDATION, 'message-too-long'],
  [REVERT_REQUEST_ERROR_CODES.recentlySent, 'recently-requested'],
  [REVERT_REQUEST_ERROR_CODES.ownProposal, 'own-proposal'],
  [REVERT_REQUEST_ERROR_CODES.requesterUnavailable, 'requester-unavailable'],
];

export const revertOperations = async (
  proposalId: string,
  operationKeys: readonly string[],
): Promise<RevertActionResult> => {
  try {
    const res = await apiv3Post<{ result?: RevertResult }>(
      `${getChangeProposalDetailKey(proposalId)}/revert`,
      { operationKeys },
    );
    if (res.data.result == null) {
      return { type: 'error' };
    }
    return { type: 'done', result: res.data.result };
  } catch (err) {
    if (extractErrorCodes(err).includes(API_CODE_NOT_FOUND)) {
      return { type: 'not-found' };
    }
    return { type: 'error' };
  }
};

export const refreshAfterRevert = async (proposalId: string): Promise<void> => {
  await Promise.all([
    mutate(getChangeProposalDetailKey(proposalId)),
    mutateRecentlyUpdated(),
    mutateAllRevisionMarks(),
  ]);
};

export const sendRevertRequest = async (
  proposalId: string,
  message: string,
): Promise<RevertRequestResult> => {
  const body: RevertRequestBody = { message };
  try {
    await apiv3Post(
      `${getChangeProposalDetailKey(proposalId)}/revert-request`,
      body,
    );
    return { type: 'sent' };
  } catch (err) {
    const codes = extractErrorCodes(err);
    const matched = REQUEST_ERROR_CODES.find(([apiCode]) =>
      codes.includes(apiCode),
    );
    return { type: 'error', code: matched?.[1] ?? 'unknown' };
  }
};
