import { mutate } from 'swr';

import { apiv3Post } from '~/client/util/apiv3-client';
import type {
  ISearchHistory,
  RecordSearchHistoryRequestBody,
  RecordSearchHistoryResponseBody,
} from '~/features/search/interfaces/search-history';
import loggerFactory from '~/utils/logger';

import { SEARCH_HISTORIES_CACHE_KEY } from '../stores/search-history-cache-key';

const logger = loggerFactory('growi:features:search:record-search-history');

const moveToTop = (
  current: ISearchHistory[] | undefined,
  recorded: ISearchHistory,
): ISearchHistory[] | undefined =>
  current == null
    ? undefined
    : [recorded, ...current.filter((h) => h._id !== recorded._id)];

const record = async (keyword: string): Promise<void> => {
  const body: RecordSearchHistoryRequestBody = { keyword };
  const { data } = await apiv3Post<RecordSearchHistoryResponseBody>(
    '/search-history',
    body,
  );
  await mutate<ISearchHistory[]>(
    SEARCH_HISTORIES_CACHE_KEY,
    (current) => moveToTop(current, data.searchHistory),
    { revalidate: false },
  );
};

/** Fire-and-forget: never rejects; failures are logged. */
export const recordSearchHistory = (keyword: string): void => {
  record(keyword).catch((err) => {
    logger.error('Failed to record the search history', err);
  });
};
