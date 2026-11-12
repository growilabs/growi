import { isErrorV3 } from '@growi/core/dist/models';
import type { SWRConfiguration, SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

import type { ChangeProposalView } from '../../../interfaces';

export type ChangeProposalFetchResult =
  | { readonly type: 'found'; readonly proposal: ChangeProposalView }
  | { readonly type: 'not-found' };

export const getChangeProposalDetailKey = (proposalId: string): string =>
  `/change-proposals/${encodeURIComponent(proposalId)}`;

// apiv3Get rejects with the response's `errors` array, not an Error, and drops the HTTP status.
const isNotFound = (err: unknown): boolean =>
  Array.isArray(err) &&
  err.some((item) => isErrorV3(item) && item.code === 'notfound');

const toError = (err: unknown): Error => {
  if (err instanceof Error) {
    return err;
  }
  if (Array.isArray(err)) {
    const first = err.find((item) => isErrorV3(item));
    if (first != null) {
      return new Error(first.message);
    }
  }
  return new Error('Failed to fetch the change proposal');
};

const fetchChangeProposal = async (
  key: string,
): Promise<ChangeProposalFetchResult> => {
  try {
    const res = await apiv3Get<{ proposal?: ChangeProposalView }>(key);
    // Ids such as "mine" reach a list route, which answers 200 without a proposal.
    if (res.data.proposal == null) {
      return { type: 'not-found' };
    }
    return { type: 'found', proposal: res.data.proposal };
  } catch (err) {
    if (isNotFound(err)) {
      return { type: 'not-found' };
    }
    throw toError(err);
  }
};

export const useSWRxChangeProposal = (
  proposalId: string | null,
  config?: SWRConfiguration<ChangeProposalFetchResult, Error>,
): SWRResponse<ChangeProposalFetchResult, Error> =>
  useSWR<ChangeProposalFetchResult, Error>(
    proposalId == null ? null : getChangeProposalDetailKey(proposalId),
    fetchChangeProposal,
    config,
  );
