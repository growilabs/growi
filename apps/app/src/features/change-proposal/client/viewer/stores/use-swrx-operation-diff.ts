import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Post } from '~/client/util/apiv3-client';
import type {
  RevisionDiffRequestPair,
  RevisionDiffResponse,
} from '~/features/revision-diff/interfaces';
import loggerFactory from '~/utils/logger';

import type { OperationView } from '../../../interfaces';
import { APPLIED_AT_LEAST_ONCE_STATUSES } from '../../../interfaces';

const logger = loggerFactory(
  'growi:feature:change-proposal:viewer:use-swrx-operation-diff',
);

const ENDPOINT = '/revisions/diff';

export type OperationDiffResult =
  | { readonly type: 'diff'; readonly unifiedDiff: string }
  | { readonly type: 'unavailable' };

export type DiffPairResult =
  | { readonly type: 'pair'; readonly pair: RevisionDiffRequestPair }
  | { readonly type: 'no-diff' }
  | { readonly type: 'unavailable' };

const NO_DIFF: DiffPairResult = { type: 'no-diff' };
const UNAVAILABLE: DiffPairResult = { type: 'unavailable' };

export const toDiffPair = (op: OperationView): DiffPairResult => {
  if (op.type !== 'edit' && op.type !== 'create') {
    return NO_DIFF;
  }
  if (!APPLIED_AT_LEAST_ONCE_STATUSES.includes(op.status)) {
    return NO_DIFF;
  }

  const pageId = op.page?.id;
  const toRevisionId = op.resultRevisionId;
  if (pageId == null || toRevisionId == null) {
    return UNAVAILABLE;
  }

  if (op.type === 'create') {
    return {
      type: 'pair',
      pair: { pageId, fromRevisionId: null, toRevisionId },
    };
  }

  if (op.baseRevisionId == null) {
    return UNAVAILABLE;
  }
  return {
    type: 'pair',
    pair: { pageId, fromRevisionId: op.baseRevisionId, toRevisionId },
  };
};

const fetchOperationDiff = async (
  diffPair: DiffPairResult,
): Promise<OperationDiffResult> => {
  if (diffPair.type !== 'pair') {
    return { type: 'unavailable' };
  }

  try {
    const res = await apiv3Post<RevisionDiffResponse>(ENDPOINT, {
      pairs: [diffPair.pair],
    });
    const item = res.data.results[0];
    if (item?.status === 'ok') {
      return { type: 'diff', unifiedDiff: item.diff };
    }
    return { type: 'unavailable' };
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch the operation diff');
    return { type: 'unavailable' };
  }
};

export const useSWRxOperationDiff = (
  op: OperationView,
  isOpen: boolean,
): SWRResponse<OperationDiffResult, Error> => {
  const diffPair = toDiffPair(op);

  let key: readonly string[] | null = null;
  if (isOpen && diffPair.type === 'pair') {
    const { pageId, fromRevisionId, toRevisionId } = diffPair.pair;
    key = [ENDPOINT, pageId, fromRevisionId ?? '', toRevisionId];
  } else if (isOpen && diffPair.type === 'unavailable') {
    key = [ENDPOINT, 'unavailable', op.key];
  }

  return useSWR<OperationDiffResult, Error>(
    key,
    () => fetchOperationDiff(diffPair),
    { revalidateOnFocus: false },
  );
};
