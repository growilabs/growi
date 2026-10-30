export type ISearchHistory = {
  _id: string;
  keyword: string;
  // Revived into a Date by the client's search-history API; the client relies on server-side ordering only
  lastSearchedAt: Date;
};

export type RecordSearchHistoryRequestBody = { keyword: string };
export type ListSearchHistoriesResponseBody = {
  searchHistories: ISearchHistory[];
};
export type RecordSearchHistoryResponseBody = { searchHistory: ISearchHistory };
