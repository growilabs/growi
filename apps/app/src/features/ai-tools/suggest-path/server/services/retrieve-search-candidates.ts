import type { IUserHasId } from '@growi/core/dist/interfaces';

import type {
  SearchCandidate,
  SearchResultItem,
  SearchService,
} from '../../interfaces/suggest-path-types';

const DEFAULT_SCORE_THRESHOLD = 5.0;
const SEARCH_RESULT_LIMIT = 20;

export type RetrieveSearchCandidatesOptions = {
  searchService: SearchService;
  scoreThreshold?: number;
};

// Elasticsearch highlights use <em class='highlighted-keyword'> and </em>
const ES_HIGHLIGHT_TAG_REGEX = /<\/?em[^>]*>/g;

function stripHighlightTags(text: string): string {
  return text.replace(ES_HIGHLIGHT_TAG_REGEX, '');
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

  return stripHighlightTags(fragments.join(' ... '));
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
