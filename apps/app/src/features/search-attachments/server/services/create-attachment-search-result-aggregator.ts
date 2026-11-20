import type SearchService from '~/server/service/search';
import type { ElasticsearchClientDelegator } from '~/server/service/search-delegator/elasticsearch-client-delegator';

import {
  type AttachmentSearchResponse,
  AttachmentSearchResultAggregator,
} from './attachment-search-result-aggregator';
import { createFindSnippetVisiblePageIds } from './find-snippet-visible-page-ids';
import {
  createSearchAccessiblePages,
  type PageIndexSearchResponse,
} from './search-accessible-pages';
import { searchWithTopLevelParams } from './search-with-top-level-params';

export type CreateAttachmentSearchResultAggregatorArgs = {
  searchService: Pick<
    SearchService,
    'searchFormattedPages' | 'fullTextSearchDelegator' | 'canShowSnippet'
  >;
  esClient: ElasticsearchClientDelegator;
  attachmentIndexName: string;
  primaryTimeoutMs?: number;
  secondaryTimeoutMs?: number;
};

export const createAttachmentSearchResultAggregator = ({
  searchService,
  esClient,
  attachmentIndexName,
  primaryTimeoutMs,
  secondaryTimeoutMs,
}: CreateAttachmentSearchResultAggregatorArgs): AttachmentSearchResultAggregator => {
  const searchAccessiblePages = createSearchAccessiblePages(
    searchService.fullTextSearchDelegator,
    async (params) =>
      (await searchWithTopLevelParams(
        esClient,
        params,
      )) as PageIndexSearchResponse,
    createFindSnippetVisiblePageIds(searchService),
  );

  // The page list comes from the regular page search pipeline for the same viewer.
  return new AttachmentSearchResultAggregator(
    (input, options) => searchService.searchFormattedPages(input, options),
    {
      searchAttachments: async (body) =>
        (await searchWithTopLevelParams(esClient, {
          index: attachmentIndexName,
          ...body,
        })) as AttachmentSearchResponse,
      searchAccessiblePages,
    },
    primaryTimeoutMs,
    secondaryTimeoutMs,
  );
};
