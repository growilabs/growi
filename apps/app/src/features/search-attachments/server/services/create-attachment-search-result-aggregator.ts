import type { estypes as ES8types } from '@elastic/elasticsearch8';
import type { estypes as ES9types } from '@elastic/elasticsearch9';

import type { ISearchResult, ISearchResultData } from '~/interfaces/search';
import type SearchService from '~/server/service/search';
import {
  type ElasticsearchClientDelegator,
  isES8ClientDelegator,
  isES9ClientDelegator,
} from '~/server/service/search-delegator/elasticsearch-client-delegator';

import {
  type AttachmentSearchResponse,
  AttachmentSearchResultAggregator,
  type PageSearchFn,
} from './attachment-search-result-aggregator';
import {
  createSearchAccessiblePages,
  type PageIndexSearchResponse,
} from './search-accessible-pages';

/**
 * Sends a search request with top-level parameters (`query`, `size`,
 * `highlight`, ...). Both the v8 and the v9 clients accept this shape; the v9
 * client no longer reads a `body` wrapper.
 */
const searchWithTopLevelParams = (
  client: ElasticsearchClientDelegator,
  params: Record<string, unknown>,
): Promise<unknown> => {
  if (isES8ClientDelegator(client)) {
    return client.search(params as ES8types.SearchRequest);
  }
  if (isES9ClientDelegator(client)) {
    return client.search(params as ES9types.SearchRequest);
  }
  throw new Error('Unsupported Elasticsearch version');
};

export type CreateAttachmentSearchResultAggregatorArgs = {
  searchService: Pick<
    SearchService,
    'searchKeyword' | 'fullTextSearchDelegator'
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
  // The page list comes from the regular page search pipeline for the same viewer.
  const pageSearchFn: PageSearchFn = async (
    keyword,
    viewer,
    { from, size },
  ) => {
    const [result] = await searchService.searchKeyword(
      keyword,
      null,
      viewer.user,
      viewer.userGroups,
      { offset: from, limit: size },
    );
    return result as ISearchResult<ISearchResultData>;
  };

  const searchAccessiblePages = createSearchAccessiblePages(
    searchService.fullTextSearchDelegator,
    async (params) =>
      (await searchWithTopLevelParams(
        esClient,
        params,
      )) as PageIndexSearchResponse,
  );

  return new AttachmentSearchResultAggregator(
    pageSearchFn,
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
