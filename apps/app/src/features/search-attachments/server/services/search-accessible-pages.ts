import type { IUserHasId } from '@growi/core';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import { canShowSnippetForGrant } from '~/server/service/search/can-show-snippet';
import type ElasticsearchDelegator from '~/server/service/search-delegator/elasticsearch';

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

export type SearchAccessiblePagesFn = (
  pageIds: readonly string[],
  viewer: AttachmentSearchViewer,
) => Promise<AccessiblePage[]>;

const PAGE_SOURCE_FIELDS = [
  'path',
  'grant',
  'granted_users',
  'granted_groups',
  'updated_at',
];

/**
 * Returns the subset of `pageIds` whose content page search would show to
 * `viewer`: the page must pass page search's own viewer filter
 * (`filterPagesByViewer`) and page search's snippet rule
 * (`canShowSnippetForGrant`). Only pages present in the response are allowed;
 * an incomplete response (timed out or failed shards) is rejected as a whole.
 */
export const createSearchAccessiblePages =
  (
    delegator: Pick<
      ElasticsearchDelegator,
      'createSearchQuery' | 'filterPagesByViewer'
    >,
    searchPageIndex: PageIndexSearchFn,
  ): SearchAccessiblePagesFn =>
  async (pageIds, viewer) => {
    const uniqueIds = [...new Set(pageIds)];
    if (uniqueIds.length === 0) {
      return [];
    }

    const user = viewer.user ?? null;
    const userGroups = user == null ? null : viewer.userGroups;

    const query = delegator.createSearchQuery();
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

    return response.hits.hits.flatMap((hit): AccessiblePage[] => {
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
  };
