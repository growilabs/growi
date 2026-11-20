import { useMemo } from 'react';
import useSWR, { mutate } from 'swr';

import { apiv3Post } from '~/client/util/apiv3-client';
import loggerFactory from '~/utils/logger';

import type { RevisionMarkView } from '../../../interfaces';
import { REVISION_MARK_CHUNK_SIZE } from '../consts';
import { buildRevisionMarkMap, chunkRevisionIds } from '../domain';

const logger = loggerFactory(
  'growi:feature:change-proposal:viewer:use-swrx-revision-marks',
);

const ENDPOINT = '/change-proposals/revision-marks';

const EMPTY_MARKS: ReadonlyMap<string, RevisionMarkView> = new Map();

export type RevisionMarksState = {
  readonly marks: ReadonlyMap<string, RevisionMarkView>;
  readonly isLoading: boolean;
};

type RevisionMarksKey = readonly [typeof ENDPOINT, ...string[]];

const isRevisionMarksKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === ENDPOINT;

const fetchRevisionMarks = async (
  key: RevisionMarksKey,
): Promise<readonly RevisionMarkView[]> => {
  const [, ...ids] = key;
  const responses = await Promise.all(
    chunkRevisionIds(ids, REVISION_MARK_CHUNK_SIZE).map((revisionIds) =>
      apiv3Post<{ marks: RevisionMarkView[] }>(ENDPOINT, { revisionIds }),
    ),
  );
  return responses.flatMap((res) => res.data.marks);
};

export const useSWRxRevisionMarks = (
  revisionIds: readonly string[] | null,
): RevisionMarksState => {
  const key = useMemo<RevisionMarksKey | null>(() => {
    if (revisionIds == null || revisionIds.length === 0) {
      return null;
    }
    return [ENDPOINT, ...[...new Set(revisionIds)].sort()];
  }, [revisionIds]);

  const { data, isLoading } = useSWR(key, fetchRevisionMarks, {
    revalidateOnFocus: false,
    onError: (err) => {
      logger.warn({ err }, 'Failed to fetch revision marks');
    },
  });

  const marks = useMemo(
    () => (data == null ? EMPTY_MARKS : buildRevisionMarkMap(data)),
    [data],
  );

  return { marks, isLoading };
};

export const mutateAllRevisionMarks = async (): Promise<void> => {
  await mutate(isRevisionMarksKey);
};
