import type { IUserHasId } from '@growi/core';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { ResolvedFilterData } from '~/server/interfaces/search';
import { canShowSnippetForGrant } from '~/server/service/search/can-show-snippet';
import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';

import {
  EMPTY_ATTACHMENT_KEYWORD_TERMS,
  type PageFilterTerms,
} from '../queries/split-query-terms';

/**
 * The viewer of a search, resolved exactly as page search resolves it
 * (`routes/search.ts`): `userGroups` holds the ObjectIds of every internal and
 * external group the user belongs to, and is null for a guest.
 */
export type AttachmentSearchViewer = {
  readonly user: IUserHasId | null;
  readonly userGroups: ObjectIdLike[] | null;
};

export type AccessiblePage = {
  readonly pageId: string;
  readonly path: string | null;
  readonly updatedAt: string | null;
};

type PageIndexSource = {
  path?: string;
  grant?: number;
  granted_users?: string[];
  granted_groups?: string[];
  updated_at?: string;
};

export type PageIndexSearchParams = {
  index: string;
  query: Record<string, unknown>;
  _source: string[];
  size: number;
};

export type PageIndexSearchResponse = {
  timed_out?: boolean;
  _shards?: { total?: number; successful?: number; failed?: number };
  hits: { hits: Array<{ _id?: string; _source?: PageIndexSource }> };
};

export type PageIndexSearchFn = (
  params: PageIndexSearchParams,
) => Promise<PageIndexSearchResponse>;

/** The operator part of the query, applied to the parent page. */
export type PageSearchFilter = {
  readonly terms: PageFilterTerms;
  readonly resolvedFilterData: ResolvedFilterData;
};

export type SearchAccessiblePagesFn = (
  pageIds: readonly string[],
  viewer: AttachmentSearchViewer,
  filter: PageSearchFilter,
) => Promise<AccessiblePage[]>;

/**
 * The ids (among pageIds) whose MongoDB page document lets the viewer see
 * content, judged as page search judges snippets. Must throw on failure.
 */
export type FindSnippetVisiblePageIdsFn = (
  pageIds: readonly string[],
  viewer: AttachmentSearchViewer,
) => Promise<Set<string>>;

const PAGE_SOURCE_FIELDS = [
  'path',
  'grant',
  'granted_users',
  'granted_groups',
  'updated_at',
];

/**
 * Returns the subset of `pageIds` whose content page search would show to
 * `viewer` for the same query: the page must match the query's operators and
 * page search's own viewer filter on the page index (built with the same
 * query builders page search uses), and page search's snippet rule
 * (`canShowSnippetForGrant`) must allow it both on the page index and on the
 * MongoDB page document, which is what page search judges snippets by. Only
 * pages present in both answers are allowed; an incomplete page index response
 * (timed out or failed shards) or a failed MongoDB lookup rejects the call.
 */
export const createSearchAccessiblePages =
  (
    delegator: Pick<
      ElasticsearchDelegator,
      | 'createSearchQuery'
      | 'appendCriteriaForQueryString'
      | 'appendCriteriaForGroupFilter'
      | 'filterPagesByViewer'
    >,
    searchPageIndex: PageIndexSearchFn,
    findSnippetVisiblePageIds: FindSnippetVisiblePageIdsFn,
  ): SearchAccessiblePagesFn =>
  async (pageIds, viewer, filter) => {
    const uniqueIds = [...new Set(pageIds)];
    if (uniqueIds.length === 0) {
      return [];
    }

    const user = viewer.user ?? null;
    const userGroups = user == null ? null : viewer.userGroups;

    const query = delegator.createSearchQuery();
    const terms = { ...filter.terms, ...EMPTY_ATTACHMENT_KEYWORD_TERMS };
    delegator.appendCriteriaForQueryString(query, terms);
    delegator.appendCriteriaForGroupFilter(
      query,
      terms,
      filter.resolvedFilterData,
    );
    delegator.filterPagesByViewer(query, user, userGroups);

    const bool = query.body?.query?.bool;
    if (bool == null || !Array.isArray(bool.filter)) {
      throw new Error('The viewer filter did not initialize the bool query');
    }

    const response = await searchPageIndex({
      index: query.index,
      query: {
        bool: {
          ...bool,
          filter: [...bool.filter, { ids: { values: uniqueIds } }],
        },
      },
      _source: PAGE_SOURCE_FIELDS,
      size: uniqueIds.length,
    });

    if (response.timed_out === true) {
      throw new Error('The page index search timed out');
    }
    if ((response._shards?.failed ?? 0) > 0) {
      throw new Error(
        `The page index search had ${response._shards?.failed} failed shard(s)`,
      );
    }

    const snippetViewer = {
      userId: user?._id.toString() ?? null,
      userGroupIds: userGroups?.map((id) => id.toString()) ?? null,
    };
    const requested = new Set(uniqueIds);

    const indexed = response.hits.hits.flatMap((hit): AccessiblePage[] => {
      const pageId = hit._id;
      const source = hit._source;
      if (pageId == null || source == null || !requested.has(pageId)) {
        return [];
      }
      const visible = canShowSnippetForGrant(
        {
          grant: source.grant,
          grantedUserIds: source.granted_users ?? [],
          grantedGroupIds: source.granted_groups ?? [],
        },
        snippetViewer,
      );
      if (!visible) {
        return [];
      }
      return [
        {
          pageId,
          path: source.path ?? null,
          updatedAt: source.updated_at ?? null,
        },
      ];
    });
    if (indexed.length === 0) {
      return [];
    }

    const visibleInMongo = await findSnippetVisiblePageIds(
      indexed.map((page) => page.pageId),
      { user, userGroups },
    );
    return indexed.filter((page) => visibleInMongo.has(page.pageId));
  };
