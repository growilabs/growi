import type {
  ISearchHistory,
  RecordSearchHistoryRequestBody,
  RecordSearchHistoryResponseBody,
} from '~/features/search/interfaces/search-history';
import axios from '~/utils/axios';

const SEARCH_HISTORY_API_PATH = '/_api/v3/search-history';

// The shared apiv3 client turns every ISO-shaped string into a Date, keywords included,
// so this API parses its own responses and revives lastSearchedAt only
const parseSearchHistoryResponse = (data: unknown): unknown => {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data, (key, value) =>
      key === 'lastSearchedAt' && typeof value === 'string'
        ? new Date(value)
        : value,
    );
  } catch {
    return data;
  }
};

const requestConfig = { transformResponse: [parseSearchHistoryResponse] };

export const postSearchHistory = async (
  keyword: string,
): Promise<ISearchHistory> => {
  const body: RecordSearchHistoryRequestBody = { keyword };
  const { data } = await axios.post<RecordSearchHistoryResponseBody>(
    SEARCH_HISTORY_API_PATH,
    body,
    requestConfig,
  );
  return data.searchHistory;
};
