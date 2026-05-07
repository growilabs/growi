/**
 * AttachmentSearchResultAggregator
 *
 * Implements the priority-slot-driven search model:
 * - facet=pages  : existing page search only (attachments_index not touched)
 * - facet=all    : msearch pages+attachments in parallel (from==0 only); fall back to pages-only for from>0
 * - facet=attachments: attachment index primary, mget page_index for permission filter
 *
 * Safety net: if primary latency > PRIMARY_TIMEOUT_MS, degrade gracefully.
 */

import type { IAttachmentHit } from '~/features/search-attachments/interfaces/attachment-search';
import type {
  IPageWithSearchMeta,
  ISearchResult,
  ISearchResultData,
} from '~/interfaces/search';
import loggerFactory from '~/utils/logger';

import { buildAttachmentSearchQuery } from '../queries/build-attachment-search-query';
import { buildSnippetSegments } from '../queries/build-snippet-segments';
import { mgetPagesForPermissionBody } from '../queries/mget-pages-for-permission-body';

const logger = loggerFactory('growi:service:search-attachments:aggregator');

// ---------------------------------------------------------------------------
// Types for injected dependencies (abstracted for testability)
// ---------------------------------------------------------------------------

/**
 * Callback signature for the existing page search pipeline.
 * The aggregator delegates all page search logic to this function.
 */
export type PageSearchFn = (
  keyword: string,
  options: { from: number; size: number },
) => Promise<ISearchResult<ISearchResultData>>;

/**
 * Raw ES hit shape returned from the attachments index.
 */
export interface AttachmentEsHit {
  _id: string;
  _score: number | null;
  _source: {
    attachmentId: string;
    pageId: string;
    fileName: string;
    originalName: string;
    fileFormat: string;
    fileSize: number;
    pageNumber: number | null;
    label: string | null;
    content?: string;
  };
  highlight?: {
    content?: string[];
    'content.ja'?: string[];
    'content.en'?: string[];
    fileName?: string[];
    originalName?: string[];
  };
}

/**
 * Raw ES hits wrapper from an attachment search.
 */
export interface AttachmentSearchResponse {
  hits: {
    total: { value: number } | number;
    hits: AttachmentEsHit[];
  };
}

/**
 * Single mget doc entry (simplified — covers found/not-found shape).
 */
export interface MgetDoc {
  _id: string;
  found: boolean;
}

/**
 * Result of a mget call for page permission checking.
 */
export interface MgetPagesResponse {
  docs: MgetDoc[];
}

/**
 * Abstraction over attachment index ES operations.
 * Injected into the aggregator; can be mocked in unit tests.
 */
export interface AttachmentIndexClient {
  /** Executes a search against the attachments alias. */
  searchAttachments(
    body: Record<string, unknown>,
  ): Promise<AttachmentSearchResponse>;
  /** Fetches permission-relevant fields for page IDs from the page alias. */
  mgetPages(pageIds: string[]): Promise<MgetPagesResponse>;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface IPrimarySearchResult {
  facet: 'all' | 'pages' | 'attachments';
  primarySlot: 'pages' | 'attachments';
  items: IPageWithSearchMeta[];
  meta: {
    total: number | null;
    nextCursor?: string;
    primaryResultIncomplete?: boolean;
  };
  secondary?: ISecondarySearchResult;
}

export interface ISecondarySearchResult {
  attachmentHitsByPageId: Record<string, IAttachmentHit[]>;
}

// ---------------------------------------------------------------------------
// Over-fetch multiplier for facet=attachments
// ---------------------------------------------------------------------------

const OVER_FETCH_MULTIPLIER = 1.5;

// ---------------------------------------------------------------------------
// Helper: resolve ES total count
// ---------------------------------------------------------------------------
const resolveTotal = (
  total: { value: number } | number | undefined,
): number => {
  if (total == null) return 0;
  if (typeof total === 'number') return total;
  return total.value;
};

// ---------------------------------------------------------------------------
// Helper: map a single ES attachment hit to IAttachmentHit
// ---------------------------------------------------------------------------
const toAttachmentHit = (esHit: AttachmentEsHit): IAttachmentHit => {
  const { _source, highlight } = esHit;

  // Prefer content highlight, fall back to content.ja / content.en
  const rawFragment =
    highlight?.content?.[0] ??
    highlight?.['content.ja']?.[0] ??
    highlight?.['content.en']?.[0] ??
    '';

  return {
    attachmentId: _source.attachmentId,
    pageId: _source.pageId,
    fileName: _source.fileName,
    originalName: _source.originalName,
    fileFormat: _source.fileFormat,
    fileSize: _source.fileSize,
    snippets: buildSnippetSegments(rawFragment),
    pageNumber: _source.pageNumber,
    label: _source.label,
  };
};

// ---------------------------------------------------------------------------
// Helper: build attachment hits grouped by pageId
// ---------------------------------------------------------------------------
const groupHitsByPageId = (
  hits: AttachmentEsHit[],
): Record<string, IAttachmentHit[]> => {
  const byPageId: Record<string, IAttachmentHit[]> = {};
  for (const hit of hits) {
    const pageId = hit._source.pageId;
    if (byPageId[pageId] == null) {
      byPageId[pageId] = [];
    }
    byPageId[pageId].push(toAttachmentHit(hit));
  }
  return byPageId;
};

// ---------------------------------------------------------------------------
// Helper: timeout race
// ---------------------------------------------------------------------------
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      // Use setTimeout to give the actual promise a chance first
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
};

// ---------------------------------------------------------------------------
// AttachmentSearchResultAggregator
// ---------------------------------------------------------------------------

export class AttachmentSearchResultAggregator {
  constructor(
    private readonly pageSearchFn: PageSearchFn,
    private readonly attachmentClient: AttachmentIndexClient,
    private readonly PRIMARY_TIMEOUT_MS: number = 800,
  ) {}

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async searchPrimary(
    query: string,
    options: {
      facet: 'all' | 'pages' | 'attachments';
      from: number;
      size: number;
    },
  ): Promise<IPrimarySearchResult> {
    const { facet, from, size } = options;

    // facet=pages: MUST NOT touch attachments_index at all
    if (facet === 'pages') {
      return await this.searchPrimaryPages(query, from, size);
    }

    if (facet === 'all') {
      // from>0: only page search (same as facet=pages), no attachment query
      if (from > 0) {
        return await this.searchPrimaryPages(query, from, size);
      }
      // from==0: parallel msearch pages+attachments with 800ms safety net
      return await this.searchPrimaryAll(query, size);
    }

    if (facet === 'attachments') {
      return await this.searchPrimaryAttachments(query, size);
    }

    // Should never reach here given TypeScript exhaustive check, but handle defensively
    throw new Error(`Unknown facet: ${facet}`);
  }

  // --------------------------------------------------------------------------
  // facet=pages (or facet=all from>0) — pages-only, no attachment index access
  // --------------------------------------------------------------------------

  private async searchPrimaryPages(
    query: string,
    from: number,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const result = await this.pageSearchFn(query, { from, size });

    const items: IPageWithSearchMeta[] = result.data.map((d) => ({
      data: {
        _id: d._id,
        ...d._source,
      } as IPageWithSearchMeta['data'],
      meta: {
        elasticSearchResult: {
          snippet: d._highlight?.body?.[0] ?? null,
          highlightedPath: d._highlight?.path?.[0] ?? null,
        },
      },
    }));

    return {
      facet: 'pages',
      primarySlot: 'pages',
      items,
      meta: {
        total: result.meta.total,
      },
    };
  }

  // --------------------------------------------------------------------------
  // facet=all, from==0 — parallel page + attachment search with safety net
  // --------------------------------------------------------------------------

  private async searchPrimaryAll(
    query: string,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const pageSearchPromise = this.pageSearchFn(query, { from: 0, size });
    const attachmentSearchBody = buildAttachmentSearchQuery(query, {
      highlight: true,
      size,
      from: 0,
    });
    const attachmentSearchPromise =
      this.attachmentClient.searchAttachments(attachmentSearchBody);

    // Both run in parallel; race against the safety net timeout
    const bothPromise = Promise.all([
      pageSearchPromise,
      attachmentSearchPromise,
    ]);

    let pageResult: ISearchResult<ISearchResultData>;
    let attachmentResponse: AttachmentSearchResponse;

    try {
      [pageResult, attachmentResponse] = await withTimeout(
        bothPromise,
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // Safety net: degrade to pages-only result on timeout
      logger.warn(
        { err, querySnippet: query.slice(0, 50) },
        'searchPrimaryAll: primary timeout — degrading to pages-only',
      );
      // Attempt to get pages result alone (it may already be done)
      // We can't recover the page promise since it's in bothPromise; fall back to a new call
      const degradedResult = await this.pageSearchFn(query, { from: 0, size });
      const items: IPageWithSearchMeta[] = degradedResult.data.map((d) => ({
        data: { _id: d._id, ...d._source } as IPageWithSearchMeta['data'],
        meta: {
          elasticSearchResult: {
            snippet: d._highlight?.body?.[0] ?? null,
            highlightedPath: d._highlight?.path?.[0] ?? null,
          },
        },
      }));
      return {
        facet: 'all',
        primarySlot: 'pages',
        items,
        meta: { total: degradedResult.meta.total },
      };
    }

    // Build a set of pageIds from the top page results (Interpretation A)
    const pageIdSet = new Set(pageResult.data.map((d) => d._id));

    // Group attachment hits by pageId
    const attachmentHitsByPageId = groupHitsByPageId(
      attachmentResponse.hits.hits,
    );

    // Build result items — embed only attachment hits for pageIds that appear in page results
    const items: IPageWithSearchMeta[] = pageResult.data.map((d) => {
      const pageId = d._id;
      const attachmentHits = pageIdSet.has(pageId)
        ? (attachmentHitsByPageId[pageId] ?? [])
        : [];

      return {
        data: { _id: pageId, ...d._source } as IPageWithSearchMeta['data'],
        meta: {
          elasticSearchResult: {
            snippet: d._highlight?.body?.[0] ?? null,
            highlightedPath: d._highlight?.path?.[0] ?? null,
          },
          ...(attachmentHits.length > 0 ? { attachmentHits } : {}),
        },
      };
    });

    return {
      facet: 'all',
      primarySlot: 'pages',
      items,
      meta: { total: pageResult.meta.total },
    };
  }

  // --------------------------------------------------------------------------
  // facet=attachments — attachment index primary + mget permission filter
  // --------------------------------------------------------------------------

  private async searchPrimaryAttachments(
    query: string,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const overFetchSize = Math.ceil(size * OVER_FETCH_MULTIPLIER);

    const attachmentSearchBody = buildAttachmentSearchQuery(query, {
      highlight: true,
      size: overFetchSize,
      from: 0,
    });

    let attachmentResponse: AttachmentSearchResponse;
    try {
      attachmentResponse = await withTimeout(
        this.attachmentClient.searchAttachments(attachmentSearchBody),
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // Safety net: return empty + incomplete on timeout
      logger.warn(
        { err, querySnippet: query.slice(0, 50) },
        'searchPrimaryAttachments: primary timeout — returning empty + incomplete',
      );
      return {
        facet: 'attachments',
        primarySlot: 'attachments',
        items: [],
        meta: {
          total: null,
          primaryResultIncomplete: true,
        },
      };
    }

    const esHits = attachmentResponse.hits.hits;

    if (esHits.length === 0) {
      return {
        facet: 'attachments',
        primarySlot: 'attachments',
        items: [],
        meta: {
          total: resolveTotal(attachmentResponse.hits.total),
          primaryResultIncomplete: false,
        },
      };
    }

    // Collect unique pageIds from attachment hits
    const uniquePageIds = [...new Set(esHits.map((h) => h._source.pageId))];

    // mget page_index for permission filtering
    let mgetResponse: MgetPagesResponse;
    try {
      mgetResponse = await withTimeout(
        this.attachmentClient.mgetPages(uniquePageIds),
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // fail-close: if mget fails, return empty + incomplete
      logger.warn(
        { err, querySnippet: query.slice(0, 50) },
        'searchPrimaryAttachments: mget timeout — returning empty + incomplete (fail-close)',
      );
      return {
        facet: 'attachments',
        primarySlot: 'attachments',
        items: [],
        meta: {
          total: null,
          primaryResultIncomplete: true,
        },
      };
    }

    // Build set of authorized pageIds (found:true = authorized)
    const authorizedPageIds = new Set<string>(
      mgetResponse.docs.filter((doc) => doc.found).map((doc) => doc._id),
    );

    // Filter attachment hits to only those whose pageId is authorized
    const authorizedHits = esHits.filter((h) =>
      authorizedPageIds.has(h._source.pageId),
    );

    // Group authorized hits by pageId
    const hitsByPageId = groupHitsByPageId(authorizedHits);

    // Build one IPageWithSearchMeta per unique pageId (up to `size` items)
    const authorizedPageIdList = [
      ...new Set(authorizedHits.map((h) => h._source.pageId)),
    ].slice(0, size);

    const items: IPageWithSearchMeta[] = authorizedPageIdList.map((pageId) => ({
      data: { _id: pageId } as IPageWithSearchMeta['data'],
      meta: {
        attachmentHits: hitsByPageId[pageId] ?? [],
      },
    }));

    const primaryResultIncomplete =
      items.length < size && esHits.length >= overFetchSize;

    return {
      facet: 'attachments',
      primarySlot: 'attachments',
      items,
      meta: {
        total: resolveTotal(attachmentResponse.hits.total),
        primaryResultIncomplete,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Factory: builds an AttachmentIndexClient from a raw ES search function
// ---------------------------------------------------------------------------

/**
 * Raw ES search function type — accepts an index name and body, returns ES response.
 */
export type RawEsSearchFn = (
  index: string,
  body: Record<string, unknown>,
) => Promise<AttachmentSearchResponse>;

/**
 * Raw ES mget function type — accepts an index name and body, returns mget response.
 */
export type RawEsMgetFn = (
  index: string,
  body: Record<string, unknown>,
) => Promise<MgetPagesResponse>;

/**
 * Creates an AttachmentIndexClient from raw ES search + mget functions.
 * Use this in production wiring; inject a mock in unit tests.
 */
export const createAttachmentIndexClient = (
  attachmentIndexAlias: string,
  pageIndexAlias: string,
  rawSearch: RawEsSearchFn,
  rawMget: RawEsMgetFn,
): AttachmentIndexClient => ({
  searchAttachments: (body) => rawSearch(attachmentIndexAlias, body),
  mgetPages: (pageIds) =>
    rawMget(pageIndexAlias, mgetPagesForPermissionBody(pageIds)),
});
