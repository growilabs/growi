export type ISearchHistory = {
  _id: string;
  keyword: string;
  // The shared apiv3 axios client revives ISO strings into Date; the client relies on server-side ordering only
  lastSearchedAt: Date;
};

export type RecordSearchHistoryRequestBody = { keyword: string };
export type ListSearchHistoriesResponseBody = {
  searchHistories: ISearchHistory[];
};
export type RecordSearchHistoryResponseBody = { searchHistory: ISearchHistory };
