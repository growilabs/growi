import { useEffect, useMemo, useRef, useState } from 'react';

import loggerFactory from '~/utils/logger';

import type {
  ChangeProposalView,
  OperationView,
  RevertResult,
} from '../../../interfaces';
import {
  REVERT_PROGRESS_POLL_INTERVAL_MS,
  REVERT_PROGRESS_POLL_TIMEOUT_MS,
} from '../consts';
import type { RevertProgressEntry } from '../domain';
import { deriveRevertProgress } from '../domain';
import { refreshAfterRevert } from './proposal-actions';
import type { ChangeProposalFetchResult } from './use-swrx-change-proposal';
import { useSWRxChangeProposal } from './use-swrx-change-proposal';

const logger = loggerFactory(
  'growi:feature:change-proposal:viewer:use-revert-progress',
);

export type RevertProgressState = {
  readonly entries: readonly RevertProgressEntry[];
  readonly isSettled: boolean;
  // Polling stopped while some sent key was still in progress.
  readonly isTimedOut: boolean;
};

// A later not-found must not erase what an earlier response already showed,
// otherwise settled entries would flip back to in-progress or lose a reason.
const useLastFoundProposal = (
  proposalId: string | null,
  data: ChangeProposalFetchResult | undefined,
): ChangeProposalView | null => {
  const current = data?.type === 'found' ? data.proposal : null;
  const [lastFound, setLastFound] = useState<{
    readonly proposalId: string;
    readonly proposal: ChangeProposalView;
  } | null>(null);

  useEffect(() => {
    if (proposalId != null && current != null) {
      setLastFound({ proposalId, proposal: current });
    }
  }, [proposalId, current]);

  if (current != null) {
    return current;
  }
  return lastFound != null && lastFound.proposalId === proposalId
    ? lastFound.proposal
    : null;
};

// Each revert result gets its own polling window; a later result passed to the
// same mounted hook must start over instead of inheriting the previous stop.
type PollingStop = {
  readonly forResult: RevertResult | null;
  readonly settled: boolean;
  readonly timedOut: boolean;
};

const INITIAL_STOP: PollingStop = {
  forResult: null,
  settled: false,
  timedOut: false,
};

const markStop = (
  prev: PollingStop,
  result: RevertResult,
  field: 'settled' | 'timedOut',
): PollingStop => {
  if (prev.forResult !== result) {
    return { ...INITIAL_STOP, forResult: result, [field]: true };
  }
  return prev[field] ? prev : { ...prev, [field]: true };
};

// `result` identifies one revert: pass the same reference for as long as that
// revert is shown (e.g. the value kept in state), and a new one per revert.
export const useRevertProgress = ({
  originalProposalId,
  sentKeys,
  result,
  originalOperations,
}: {
  readonly originalProposalId: string;
  readonly sentKeys: readonly string[];
  readonly result: RevertResult;
  readonly originalOperations: readonly OperationView[];
}): RevertProgressState => {
  const needsPolling =
    result.revertProposalId != null &&
    sentKeys.some((key) => !result.operations.some((o) => o.key === key));
  const pollProposalId = needsPolling
    ? (result.revertProposalId ?? null)
    : null;

  const [stop, setStop] = useState<PollingStop>(INITIAL_STOP);
  const isStopForResult = stop.forResult === result;
  const hasStoppedSettled = isStopForResult && stop.settled;
  const hasTimedOut = isStopForResult && stop.timedOut;
  const isPolling = needsPolling && !hasStoppedSettled && !hasTimedOut;
  // SWR calls isPaused during render through the previous render's config, so
  // a closure over isPolling would block the first fetch for a new result.
  const isPollingRef = useRef(isPolling);
  isPollingRef.current = isPolling;

  // The key stays set after polling stops so the last response is kept.
  const revertResponse = useSWRxChangeProposal(pollProposalId, {
    refreshInterval: isPolling ? REVERT_PROGRESS_POLL_INTERVAL_MS : 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    isPaused: () => !isPollingRef.current,
    // SWR skips refreshInterval ticks while the last fetch errored, so a
    // failed poll is retried on the same cadence instead.
    shouldRetryOnError: true,
    onErrorRetry: (_err, _key, _config, revalidate, opts) => {
      setTimeout(() => revalidate(opts), REVERT_PROGRESS_POLL_INTERVAL_MS);
    },
  });
  const revertProposal = useLastFoundProposal(
    pollProposalId,
    revertResponse.data,
  );

  // Only picks up the refetch that refreshAfterRevert triggers on this key.
  const originalResponse = useSWRxChangeProposal(originalProposalId, {
    revalidateOnMount: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
  const refetchedOriginal = useLastFoundProposal(
    originalProposalId,
    originalResponse.data,
  );
  const operationsForReasons =
    refetchedOriginal?.operations ?? originalOperations;

  const { entries, isSettled } = useMemo(
    () =>
      deriveRevertProgress({
        originalProposalId,
        sentKeys,
        result,
        revertProposal,
        originalOperations: operationsForReasons,
      }),
    [
      originalProposalId,
      sentKeys,
      result,
      revertProposal,
      operationsForReasons,
    ],
  );

  useEffect(() => {
    if (isSettled) {
      setStop((prev) => markStop(prev, result, 'settled'));
    }
  }, [isSettled, result]);

  const hasFirstResponse =
    needsPolling &&
    (revertResponse.data != null || revertResponse.error != null);

  useEffect(() => {
    if (!hasFirstResponse || isSettled) {
      return;
    }
    const timer = setTimeout(
      () => setStop((prev) => markStop(prev, result, 'timedOut')),
      REVERT_PROGRESS_POLL_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [hasFirstResponse, isSettled, result]);

  const isTimedOut = hasTimedOut && !isSettled;

  const refreshedForRef = useRef<RevertResult | null>(null);
  useEffect(() => {
    if (refreshedForRef.current === result || !(isSettled || isTimedOut)) {
      return;
    }
    refreshedForRef.current = result;
    refreshAfterRevert(originalProposalId).catch((err: unknown) => {
      logger.warn({ err }, 'Failed to refresh after the revert');
    });
  }, [isSettled, isTimedOut, originalProposalId, result]);

  return { entries, isSettled, isTimedOut };
};
