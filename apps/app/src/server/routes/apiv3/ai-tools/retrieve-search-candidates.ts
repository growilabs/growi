import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { SearchCandidate } from './suggest-path-types';

const DEFAULT_SCORE_THRESHOLD = 5.0;
const SEARCH_RESULT_LIMIT = 20;

type SearchResultItem = {
  _score: number;
  _source: {
    path: string;
  };
  _highlight?: Record<string, string[]>;
};

export type SearchService = {
  searchKeyword(
    keyword: string,
    nqName: string | null,
    user: IUserHasId,
    userGroups: unknown,
    opts: Record<string, unknown>,
  ): Promise<[{ data: SearchResultItem[] }, unknown]>;
};

export type RetrieveSearchCandidatesOptions = {
  searchService: SearchService;
  scoreThreshold?: number;
};

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function extractSnippet(item: SearchResultItem): string {
  const highlight = item._highlight;
  if (highlight == null) {
    return '';
  }

  const fragments =
    highlight.body ?? highlight['body.en'] ?? highlight['body.ja'];
  if (fragments == null || fragments.length === 0) {
    return '';
  }

  return stripHtmlTags(fragments.join(' ... '));
}

export const retrieveSearchCandidates = async (
  keywords: string[],
  user: IUserHasId,
  userGroups: unknown,
  options: RetrieveSearchCandidatesOptions,
): Promise<SearchCandidate[]> => {
  const { searchService, scoreThreshold = DEFAULT_SCORE_THRESHOLD } = options;
  const keyword = keywords.join(' ');

  const [searchResult] = await searchService.searchKeyword(
    keyword,
    null,
    user,
    userGroups,
    { limit: SEARCH_RESULT_LIMIT },
  );

  return searchResult.data
    .filter((item) => item._score >= scoreThreshold)
    .map((item) => ({
      pagePath: item._source.path,
      snippet: extractSnippet(item),
      score: item._score,
    }));
};
