import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { FilterXSS } from 'xss';

import type { IPageSearchMeta } from '~/interfaces/search';

// Do not change the property key name to 'whitelist" because it depends on the 'xss' library
const filterXss = new FilterXSS({
  whiteList: {
    em: ['class'],
  },
});

type ElasticSearchResult = NonNullable<IPageSearchMeta['elasticSearchResult']>;

/**
 * Turns a page document read by `findPageListByIds` into the page document
 * page search answers: `seenUserCount` added, and the populated users
 * serialized without their confidential fields. Mutates `pageData` in place
 * because the search response serializes the mongoose document itself.
 */
export const toSearchedPageDocument = (
  // biome-ignore lint/suspicious/noExplicitAny: a populated mongoose page document
  pageData: any,
  User: new (...args: never[]) => unknown,
  // biome-ignore lint/suspicious/noExplicitAny: the same populated page document
): any => {
  const isUserDocument = (value: unknown): boolean => value instanceof User;

  pageData._doc.seenUserCount = pageData.seenUsers?.length || 0;

  if (
    pageData.lastUpdateUser != null &&
    isUserDocument(pageData.lastUpdateUser)
  ) {
    pageData.lastUpdateUser = serializeUserSecurely(pageData.lastUpdateUser);
  }
  if (pageData.creator != null && isUserDocument(pageData.creator)) {
    pageData.creator = serializeUserSecurely(pageData.creator);
  }

  return pageData;
};

/**
 * The snippet and highlighted path page search shows for a page, from the
 * Elasticsearch highlight of its page_index hit. The snippet is withheld
 * unless `canShowSnippet` holds for the viewer.
 */
export const toElasticSearchResult = (
  // biome-ignore lint/suspicious/noExplicitAny: the highlight object of an Elasticsearch hit
  highlightData: any,
  canShowSnippet: boolean,
): ElasticSearchResult => {
  const snippet = canShowSnippet
    ? highlightData.body ||
      highlightData['body.en'] ||
      highlightData['body.ja'] ||
      highlightData.comments ||
      highlightData['comments.en'] ||
      highlightData['comments.ja']
    : null;
  const pathMatch = highlightData['path.en'] || highlightData['path.ja'];

  return {
    snippet:
      snippet != null && typeof snippet[0] === 'string'
        ? filterXss.process(snippet)
        : null,
    highlightedPath:
      pathMatch != null && typeof pathMatch[0] === 'string'
        ? filterXss.process(pathMatch)
        : null,
  };
};
