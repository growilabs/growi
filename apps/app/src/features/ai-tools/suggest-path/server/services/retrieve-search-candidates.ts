import type { IUserHasId } from '@growi/core/dist/interfaces';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';

import type {
  SearchCandidate,
  SearchResultItem,
  SearchService,
} from '../../interfaces/suggest-path-types';

const SCORE_THRESHOLD = 5.0;
const SEARCH_RESULT_LIMIT = 20;

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
  userGroups: ObjectIdLike[],
  searchService: SearchService,
): Promise<SearchCandidate[]> => {
  const keyword = keywords.join(' ');

  const [searchResult] = await searchService.searchKeyword(
    keyword,
    null,
    user,
    userGroups,
    { limit: SEARCH_RESULT_LIMIT },
  );

  return searchResult.data
    .filter((item) => item._score >= SCORE_THRESHOLD)
    .map((item) => ({
      pagePath: item._source.path,
      snippet: extractSnippet(item),
      score: item._score,
    }));
};
