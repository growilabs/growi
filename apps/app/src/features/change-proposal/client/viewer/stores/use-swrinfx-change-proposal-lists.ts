import { useEffect, useRef } from 'react';
import type { SWRInfiniteResponse } from 'swr/infinite';
import useSWRInfinite from 'swr/infinite';

import { apiv3Get } from '~/client/util/apiv3-client';

import type { ChangeProposalSummaryView } from '../../../interfaces';
import { APPLIED_LIST_AUTO_CONTINUE_LIMIT } from '../consts';

const MINE_ENDPOINT = '/change-proposals/mine';
const APPLIED_ENDPOINT = '/change-proposals/applied';

export type MyProposalsPage = {
  readonly items: readonly ChangeProposalSummaryView[];
  readonly hasNext: boolean;
};

export type AppliedProposalsPage = {
  readonly items: readonly ChangeProposalSummaryView[];
  readonly nextCursor: string | null;
};

type MineKey = readonly [typeof MINE_ENDPOINT, number, number];
type AppliedKey = readonly [typeof APPLIED_ENDPOINT, number, string | null];

const fetchMinePage = async ([
  endpoint,
  limit,
  page,
]: MineKey): Promise<MyProposalsPage> => {
  const res = await apiv3Get<MyProposalsPage>(endpoint, { page, limit });
  return res.data;
};

const fetchAppliedPage = async ([
  endpoint,
  limit,
  cursor,
]: AppliedKey): Promise<AppliedProposalsPage> => {
  const res = await apiv3Get<AppliedProposalsPage>(
    endpoint,
    cursor == null ? { limit } : { cursor, limit },
  );
  return res.data;
};

export const useSWRInfxMyChangeProposals = (
  limit: number,
): SWRInfiniteResponse<MyProposalsPage, Error> =>
  useSWRInfinite<MyProposalsPage, Error>(
    (pageIndex, previous): MineKey | null =>
      previous != null && !previous.hasNext
        ? null
        : [MINE_ENDPOINT, limit, pageIndex + 1],
    fetchMinePage,
    { revalidateFirstPage: false },
  );

export const useSWRInfxAppliedChangeProposals = (
  limit: number,
): SWRInfiniteResponse<AppliedProposalsPage, Error> => {
  const swr = useSWRInfinite<AppliedProposalsPage, Error>(
    (pageIndex, previous): AppliedKey | null => {
      if (pageIndex === 0) {
        return [APPLIED_ENDPOINT, limit, null];
      }
      return previous?.nextCursor == null
        ? null
        : [APPLIED_ENDPOINT, limit, previous.nextCursor];
    },
    fetchAppliedPage,
    { revalidateFirstPage: false },
  );

  const { data, size, setSize, isValidating } = swr;
  const autoLoadedCount = useRef(0);
  const sizeRequestedByEffect = useRef<number | null>(null);

  useEffect(() => {
    if (data == null || isValidating || data.length < size) {
      return;
    }
    const last = data.at(-1);
    if (last == null || last.items.length > 0 || last.nextCursor == null) {
      autoLoadedCount.current = 0;
      return;
    }
    // A size we did not request means the user asked for more: start counting again.
    if (size !== sizeRequestedByEffect.current) {
      autoLoadedCount.current = 0;
    }
    if (autoLoadedCount.current >= APPLIED_LIST_AUTO_CONTINUE_LIMIT) {
      return;
    }
    autoLoadedCount.current += 1;
    sizeRequestedByEffect.current = size + 1;
    setSize(size + 1);
  }, [data, size, isValidating, setSize]);

  return swr;
};
