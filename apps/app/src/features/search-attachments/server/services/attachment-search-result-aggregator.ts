/**
 * AttachmentSearchResultAggregator
 *
 * Implements the priority-slot-driven search model:
 * - facet=pages  : existing page search only (attachments_index not touched)
 * - facet=all    : msearch pages+attachments in parallel (from==0 only); fall back to pages-only for from>0
 * - facet=attachments: attachment index primary, then searchAccessiblePages on page_index
 *
 * Every attachment hit, on every path, passes searchAccessiblePages for the
 * viewer before it is returned; any failure there drops the hits (fail-close).
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
import {
  buildAttachmentsByPageIdsQuery,
  DEFAULT_PAGE_SIZE,
} from '../queries/build-attachments-by-page-ids-query';
import { buildSnippetSegments } from '../queries/build-snippet-segments';
import type {
  AttachmentSearchViewer,
  SearchAccessiblePagesFn,
} from './search-accessible-pages';

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
  viewer: AttachmentSearchViewer,
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
 * Abstraction over attachment index ES operations.
 * Injected into the aggregator; can be mocked in unit tests.
 */
export interface AttachmentIndexClient {
  /** Executes a search against the attachments alias. */
  searchAttachments(
    body: Record<string, unknown>,
  ): Promise<AttachmentSearchResponse>;
  /** The ids (among pageIds) whose content the viewer may see. */
  searchAccessiblePages: SearchAccessiblePagesFn;
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

/**
 * Result of resolveSecondary — enrichment data keyed by pageId.
 */
export interface IResolvedSecondaryResult {
  facet: 'all' | 'attachments';
  enrichments: Record<string, { attachmentHits?: IAttachmentHit[] }>;
}

// ---------------------------------------------------------------------------
// Over-fetch multiplier for facet=attachments
// ---------------------------------------------------------------------------

const OVER_FETCH_MULTIPLIER = 1.5;

// Secondary enrichment timeout (ms)
const DEFAULT_SECONDARY_TIMEOUT_MS = 500;

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
export class AttachmentSearchTimeoutError extends Error {
  constructor(ms: number) {
    super(`Timeout after ${ms}ms`);
    this.name = 'AttachmentSearchTimeoutError';
  }
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new AttachmentSearchTimeoutError(ms)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const failureKind = (err: unknown): 'timeout' | 'error' =>
  err instanceof AttachmentSearchTimeoutError ? 'timeout' : 'error';

// ---------------------------------------------------------------------------
// AttachmentSearchResultAggregator
// ---------------------------------------------------------------------------

const toPageItem = (d: ISearchResultData): IPageWithSearchMeta => ({
  data: { _id: d._id, ...d._source } as IPageWithSearchMeta['data'],
  meta: {
    elasticSearchResult: {
      snippet: d._highlight?.body?.[0] ?? null,
      highlightedPath: d._highlight?.path?.[0] ?? null,
    },
  },
});

export class AttachmentSearchResultAggregator {
  private readonly pageSearchFn: PageSearchFn;
  private readonly attachmentClient: AttachmentIndexClient;
  private readonly PRIMARY_TIMEOUT_MS: number;
  private readonly SECONDARY_TIMEOUT_MS: number;

  constructor(
    pageSearchFn: PageSearchFn,
    attachmentClient: AttachmentIndexClient,
    PRIMARY_TIMEOUT_MS = 800,
    SECONDARY_TIMEOUT_MS = DEFAULT_SECONDARY_TIMEOUT_MS,
  ) {
    this.pageSearchFn = pageSearchFn;
    this.attachmentClient = attachmentClient;
    this.PRIMARY_TIMEOUT_MS = PRIMARY_TIMEOUT_MS;
    this.SECONDARY_TIMEOUT_MS = SECONDARY_TIMEOUT_MS;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  async searchPrimary(
    query: string,
    viewer: AttachmentSearchViewer,
    options: {
      facet: 'all' | 'pages' | 'attachments';
      from: number;
      size: number;
    },
  ): Promise<IPrimarySearchResult> {
    const { facet, from, size } = options;

    // facet=pages: MUST NOT touch attachments_index at all
    if (facet === 'pages') {
      return await this.searchPrimaryPages(query, viewer, from, size);
    }

    if (facet === 'all') {
      // from>0: only page search (same as facet=pages), no attachment query
      if (from > 0) {
        return await this.searchPrimaryPages(query, viewer, from, size);
      }
      // from==0: parallel pages+attachments with 800ms safety net
      return await this.searchPrimaryAll(query, viewer, size);
    }

    if (facet === 'attachments') {
      return await this.searchPrimaryAttachments(query, viewer, size);
    }

    // Should never reach here given TypeScript exhaustive check, but handle defensively
    throw new Error(`Unknown facet: ${facet}`);
  }

  // --------------------------------------------------------------------------
  // Permission gate shared by every path
  // --------------------------------------------------------------------------

  /**
   * The subset of pageIds whose attachment hits the viewer may see.
   * Throws on any failure; callers must then drop the hits (fail-close).
   */
  private async findVisiblePageIds(
    pageIds: string[],
    viewer: AttachmentSearchViewer,
    timeoutMs: number,
  ): Promise<Set<string>> {
    if (pageIds.length === 0) {
      return new Set();
    }
    const pages = await withTimeout(
      this.attachmentClient.searchAccessiblePages(pageIds, viewer),
      timeoutMs,
    );
    return new Set(pages.map((p) => p.pageId));
  }

  // --------------------------------------------------------------------------
  // facet=pages (or facet=all from>0) — pages-only, no attachment index access
  // --------------------------------------------------------------------------

  private async searchPrimaryPages(
    query: string,
    viewer: AttachmentSearchViewer,
    from: number,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const result = await this.pageSearchFn(query, viewer, { from, size });

    return {
      facet: 'pages',
      primarySlot: 'pages',
      items: result.data.map(toPageItem),
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
    viewer: AttachmentSearchViewer,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const pageSearchPromise = this.pageSearchFn(query, viewer, {
      from: 0,
      size,
    });
    const attachmentSearchBody = buildAttachmentSearchQuery(query, {
      highlight: true,
      size,
      from: 0,
    });
    const attachmentSearchPromise =
      this.attachmentClient.searchAttachments(attachmentSearchBody);

    let pageResult: ISearchResult<ISearchResultData>;
    let attachmentResponse: AttachmentSearchResponse;

    try {
      [pageResult, attachmentResponse] = await withTimeout(
        Promise.all([pageSearchPromise, attachmentSearchPromise]),
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // Safety net: degrade to pages-only result
      logger.warn(
        { err, failure: failureKind(err), querySnippet: query.slice(0, 50) },
        'searchPrimaryAll: primary search failed — degrading to pages-only',
      );
      const degradedResult = await this.pageSearchFn(query, viewer, {
        from: 0,
        size,
      });
      return {
        facet: 'all',
        primarySlot: 'pages',
        items: degradedResult.data.map(toPageItem),
        meta: { total: degradedResult.meta.total },
      };
    }

    // Interpretation A: only attachment hits on pages of the primary page result
    const pageIdSet = new Set(pageResult.data.map((d) => d._id));
    const candidateHits = attachmentResponse.hits.hits.filter((h) =>
      pageIdSet.has(h._source.pageId),
    );

    let visiblePageIds = new Set<string>();
    try {
      visiblePageIds = await this.findVisiblePageIds(
        [...new Set(candidateHits.map((h) => h._source.pageId))],
        viewer,
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // fail-close: keep the page results, embed no attachment hits
      logger.warn(
        { err, failure: failureKind(err), querySnippet: query.slice(0, 50) },
        'searchPrimaryAll: permission check failed — dropping attachment hits (fail-close)',
      );
    }

    const attachmentHitsByPageId = groupHitsByPageId(
      candidateHits.filter((h) => visiblePageIds.has(h._source.pageId)),
    );

    const items: IPageWithSearchMeta[] = pageResult.data.map((d) => {
      const item = toPageItem(d);
      const attachmentHits = attachmentHitsByPageId[d._id] ?? [];
      return attachmentHits.length > 0
        ? { ...item, meta: { ...item.meta, attachmentHits } }
        : item;
    });

    return {
      facet: 'all',
      primarySlot: 'pages',
      items,
      meta: { total: pageResult.meta.total },
    };
  }

  // --------------------------------------------------------------------------
  // facet=attachments — attachment index primary + permission gate
  // --------------------------------------------------------------------------

  private async searchPrimaryAttachments(
    query: string,
    viewer: AttachmentSearchViewer,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const overFetchSize = Math.ceil(size * OVER_FETCH_MULTIPLIER);
    const incomplete: IPrimarySearchResult = {
      facet: 'attachments',
      primarySlot: 'attachments',
      items: [],
      meta: {
        total: null,
        primaryResultIncomplete: true,
      },
    };

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
      logger.warn(
        { err, failure: failureKind(err), querySnippet: query.slice(0, 50) },
        'searchPrimaryAttachments: attachment search failed — returning empty + incomplete',
      );
      return incomplete;
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

    let visiblePageIds: Set<string>;
    try {
      visiblePageIds = await this.findVisiblePageIds(
        [...new Set(esHits.map((h) => h._source.pageId))],
        viewer,
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      logger.warn(
        { err, failure: failureKind(err), querySnippet: query.slice(0, 50) },
        'searchPrimaryAttachments: permission check failed — returning empty + incomplete (fail-close)',
      );
      return incomplete;
    }

    const authorizedHits = esHits.filter((h) =>
      visiblePageIds.has(h._source.pageId),
    );
    const hitsByPageId = groupHitsByPageId(authorizedHits);

    // One IPageWithSearchMeta per unique pageId (up to `size` items)
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

  // --------------------------------------------------------------------------
  // resolveSecondary — enrichment phase after primary search
  // --------------------------------------------------------------------------

  /**
   * Resolves secondary enrichment data for page IDs supplied by the client.
   *
   * facet=attachments: primary already applied the permission gate — no-op.
   *
   * facet=all: the client-supplied ids are re-checked against the viewer with
   * searchAccessiblePages, then the attachments index is searched for the
   * surviving ids only. Any failure or a latency above 500ms returns empty
   * enrichments.
   *
   * @throws {RangeError} when the number of distinct primaryIds exceeds
   *   DEFAULT_PAGE_SIZE
   */
  async resolveSecondary(
    query: string,
    viewer: AttachmentSearchViewer,
    options: {
      facet: 'all' | 'attachments';
      primaryIds: string[];
    },
  ): Promise<IResolvedSecondaryResult> {
    const { facet, primaryIds } = options;

    if (facet === 'attachments') {
      return { facet: 'attachments', enrichments: {} };
    }

    return this.resolveSecondaryAll(query, viewer, [...new Set(primaryIds)]);
  }

  private async resolveSecondaryAll(
    query: string,
    viewer: AttachmentSearchViewer,
    primaryIds: string[],
  ): Promise<IResolvedSecondaryResult> {
    if (primaryIds.length > DEFAULT_PAGE_SIZE) {
      throw new RangeError(
        `primaryIds.length (${primaryIds.length}) exceeds the maximum allowed page size (${DEFAULT_PAGE_SIZE}). ` +
          'Split the request into smaller batches.',
      );
    }

    try {
      const enrichments = await withTimeout(
        this.doResolveSecondaryAll(query, viewer, primaryIds),
        this.SECONDARY_TIMEOUT_MS,
      );
      return { facet: 'all', enrichments };
    } catch (err) {
      logger.warn(
        { err, failure: failureKind(err), querySnippet: query.slice(0, 50) },
        'resolveSecondaryAll: secondary enrichment failed — returning empty enrichments',
      );
      return { facet: 'all', enrichments: {} };
    }
  }

  private async doResolveSecondaryAll(
    query: string,
    viewer: AttachmentSearchViewer,
    primaryIds: string[],
  ): Promise<IResolvedSecondaryResult['enrichments']> {
    // The ids come from the client: re-check them for this viewer
    const visiblePageIds = await this.findVisiblePageIds(
      primaryIds,
      viewer,
      this.SECONDARY_TIMEOUT_MS,
    );
    const validIds = primaryIds.filter((id) => visiblePageIds.has(id));

    if (validIds.length === 0) {
      return {};
    }

    const searchBody = buildAttachmentsByPageIdsQuery(query, validIds, {
      highlight: true,
    });
    const attachmentResponse =
      await this.attachmentClient.searchAttachments(searchBody);

    const enrichments: IResolvedSecondaryResult['enrichments'] = {};
    for (const hit of attachmentResponse.hits.hits) {
      const pageId = hit._source.pageId;
      // The attachments query filters by validIds; this re-check keeps the
      // gate independent of that query being correct.
      if (!visiblePageIds.has(pageId)) continue;
      const current = enrichments[pageId]?.attachmentHits ?? [];
      enrichments[pageId] = {
        attachmentHits: [...current, toAttachmentHit(hit)],
      };
    }

    return enrichments;
  }
}
