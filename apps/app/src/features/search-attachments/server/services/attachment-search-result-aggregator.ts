/**
 * AttachmentSearchResultAggregator
 *
 * Implements the priority-slot-driven search model:
 * - facet=pages  : existing page search only (attachments_index not touched)
 * - facet=all    : msearch pages+attachments in parallel (from==0 only); fall back to pages-only for from>0
 * - facet=attachments: attachment index primary, then searchAccessiblePages on page_index
 *
 * Page items always come from the regular page search pipeline (search +
 * result formatting), so they carry exactly what `/_api/search` returns.
 * Every attachment hit, on every path, passes searchAccessiblePages for the
 * viewer and the query's operators before it is returned; any failure there
 * drops the hits (fail-close). Only the keyword part of the query is matched
 * against attachment content.
 *
 * Safety net: if primary latency > PRIMARY_TIMEOUT_MS, degrade gracefully.
 */

import type { IAttachmentHit } from '~/features/search-attachments/interfaces/attachment-search';
import type {
  IFormattedSearchResult,
  IPageWithSearchMeta,
} from '~/interfaces/search';
import type {
  QueryTerms,
  ResolvedFilterData,
} from '~/server/interfaces/search';
import loggerFactory from '~/utils/logger';

import { buildAttachmentSearchQuery } from '../queries/build-attachment-search-query';
import {
  buildAttachmentsByPageIdsQuery,
  DEFAULT_PAGE_SIZE,
} from '../queries/build-attachments-by-page-ids-query';
import { buildSnippetSegments } from '../queries/build-snippet-segments';
import {
  type AttachmentKeywordTerms,
  hasPositiveKeyword,
  splitQueryTerms,
} from '../queries/split-query-terms';
import { collectVisibleAttachmentHits } from './collect-visible-attachment-hits';
import type {
  AttachmentSearchViewer,
  PageSearchFilter,
  SearchAccessiblePagesFn,
} from './search-accessible-pages';

const logger = loggerFactory('growi:service:search-attachments:aggregator');

// ---------------------------------------------------------------------------
// Types for injected dependencies (abstracted for testability)
// ---------------------------------------------------------------------------

/**
 * A query parsed once by SearchService (parseSearchQuery → resolve →
 * resolveFilterData), together with the viewer it runs for. The aggregator
 * never re-parses the query string.
 */
export type AttachmentSearchInput = {
  readonly queryString: string;
  readonly terms: QueryTerms;
  readonly resolvedFilterData: ResolvedFilterData;
  readonly viewer: AttachmentSearchViewer;
};

/**
 * Callback for the existing page search pipeline, returning the formatted
 * result exactly as `/_api/search` would.
 */
export type PageSearchFn = (
  input: AttachmentSearchInput,
  options: { from: number; size: number },
) => Promise<IFormattedSearchResult>;

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
 * Raw ES hits wrapper from an attachment search. The hit count is never
 * requested (it would count hits before the permission check).
 */
export interface AttachmentSearchResponse {
  hits: {
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
  /** The ids (among pageIds) whose content the viewer may see for the query. */
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
    /** The page search total for a page-primary result; always null for facet=attachments. */
    total: number | null;
    nextCursor?: string;
    /** facet=attachments: the attachment search or the permission check failed. */
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

// Secondary enrichment timeout (ms)
const DEFAULT_SECONDARY_TIMEOUT_MS = 500;

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

const pageIdOf = (item: IPageWithSearchMeta): string =>
  item.data._id.toString();

type SplitInput = {
  keywords: AttachmentKeywordTerms;
  filter: PageSearchFilter;
  viewer: AttachmentSearchViewer;
};

const splitInput = (input: AttachmentSearchInput): SplitInput => {
  const { keywords, filters } = splitQueryTerms(input.terms);
  return {
    keywords,
    filter: { terms: filters, resolvedFilterData: input.resolvedFilterData },
    viewer: input.viewer,
  };
};

// ---------------------------------------------------------------------------
// AttachmentSearchResultAggregator
// ---------------------------------------------------------------------------

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
    input: AttachmentSearchInput,
    options: {
      facet: 'all' | 'pages' | 'attachments';
      from: number;
      size: number;
    },
  ): Promise<IPrimarySearchResult> {
    const { facet, from, size } = options;

    // facet=pages: MUST NOT touch attachments_index at all
    if (facet === 'pages') {
      return await this.searchPrimaryPages(input, from, size);
    }

    if (facet === 'all') {
      // from>0: only page search (same as facet=pages), no attachment query
      if (from > 0) {
        return await this.searchPrimaryPages(input, from, size);
      }
      // from==0: parallel pages+attachments with 800ms safety net
      return await this.searchPrimaryAll(input, size);
    }

    if (facet === 'attachments') {
      return await this.searchPrimaryAttachments(input, from, size);
    }

    // Should never reach here given TypeScript exhaustive check, but handle defensively
    throw new Error(`Unknown facet: ${facet}`);
  }

  // --------------------------------------------------------------------------
  // Permission gate shared by every path
  // --------------------------------------------------------------------------

  /**
   * The subset of pageIds whose attachment hits the viewer may see for the
   * query. Throws on any failure; callers must then drop the hits (fail-close).
   */
  private async findVisiblePageIds(
    pageIds: string[],
    { viewer, filter }: SplitInput,
    timeoutMs: number,
  ): Promise<Set<string>> {
    if (pageIds.length === 0) {
      return new Set();
    }
    const pages = await withTimeout(
      this.attachmentClient.searchAccessiblePages(pageIds, viewer, filter),
      timeoutMs,
    );
    return new Set(pages.map((p) => p.pageId));
  }

  // --------------------------------------------------------------------------
  // facet=pages (or facet=all from>0) — pages-only, no attachment index access
  // --------------------------------------------------------------------------

  private async searchPrimaryPages(
    input: AttachmentSearchInput,
    from: number,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const result = await this.pageSearchFn(input, { from, size });

    return {
      facet: 'pages',
      primarySlot: 'pages',
      items: result.data,
      meta: {
        total: result.meta.total,
      },
    };
  }

  // --------------------------------------------------------------------------
  // facet=all, from==0 — parallel page + attachment search with safety net
  // --------------------------------------------------------------------------

  private async searchPrimaryAll(
    input: AttachmentSearchInput,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const split = splitInput(input);
    const pageSearchPromise = this.pageSearchFn(input, { from: 0, size });
    // No keyword to match attachment content with (e.g. an operator-only query)
    const attachmentSearchPromise: Promise<AttachmentSearchResponse> =
      hasPositiveKeyword(split.keywords)
        ? this.attachmentClient.searchAttachments(
            buildAttachmentSearchQuery(split.keywords, {
              highlight: true,
              size,
              from: 0,
            }),
          )
        : Promise.resolve({ hits: { hits: [] } });

    let pageResult: IFormattedSearchResult;
    let attachmentResponse: AttachmentSearchResponse;

    try {
      [pageResult, attachmentResponse] = await withTimeout(
        Promise.all([pageSearchPromise, attachmentSearchPromise]),
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // Safety net: degrade to pages-only result
      logger.warn(
        { err, failure: failureKind(err) },
        'searchPrimaryAll: primary search failed — degrading to pages-only',
      );
      const degradedResult = await this.pageSearchFn(input, { from: 0, size });
      return {
        facet: 'all',
        primarySlot: 'pages',
        items: degradedResult.data,
        meta: { total: degradedResult.meta.total },
      };
    }

    // Interpretation A: only attachment hits on pages of the primary page result
    const pageIdSet = new Set(pageResult.data.map(pageIdOf));
    const candidateHits = attachmentResponse.hits.hits.filter((h) =>
      pageIdSet.has(h._source.pageId),
    );

    let visiblePageIds = new Set<string>();
    try {
      visiblePageIds = await this.findVisiblePageIds(
        [...new Set(candidateHits.map((h) => h._source.pageId))],
        split,
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      // fail-close: keep the page results, embed no attachment hits
      logger.warn(
        { err, failure: failureKind(err) },
        'searchPrimaryAll: permission check failed — dropping attachment hits (fail-close)',
      );
    }

    const attachmentHitsByPageId = new Map<string, IAttachmentHit[]>();
    for (const hit of candidateHits) {
      const pageId = hit._source.pageId;
      if (!visiblePageIds.has(pageId)) continue;
      attachmentHitsByPageId.set(pageId, [
        ...(attachmentHitsByPageId.get(pageId) ?? []),
        toAttachmentHit(hit),
      ]);
    }

    const items: IPageWithSearchMeta[] = pageResult.data.map((item) => {
      const attachmentHits = attachmentHitsByPageId.get(pageIdOf(item));
      return attachmentHits == null
        ? item
        : { ...item, meta: { ...item.meta, attachmentHits } };
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

  /**
   * Nothing in the response may depend on hits the viewer cannot see: no
   * total is reported (`total: null`), and `primaryResultIncomplete` is set
   * only when the attachment search or the permission check failed. Paging
   * follows collectVisibleAttachmentHits.
   */
  private async searchPrimaryAttachments(
    input: AttachmentSearchInput,
    from: number,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const result = (
      items: IPageWithSearchMeta[],
      primaryResultIncomplete: boolean,
    ): IPrimarySearchResult => ({
      facet: 'attachments',
      primarySlot: 'attachments',
      items,
      meta: { total: null, primaryResultIncomplete },
    });

    const split = splitInput(input);
    if (!hasPositiveKeyword(split.keywords)) {
      return result([], false);
    }

    try {
      const pages = await withTimeout(
        collectVisibleAttachmentHits(
          {
            searchHits: async (hitsFrom, hitsSize) =>
              (
                await this.attachmentClient.searchAttachments(
                  buildAttachmentSearchQuery(split.keywords, {
                    highlight: true,
                    from: hitsFrom,
                    size: hitsSize,
                  }),
                )
              ).hits.hits,
            findVisiblePageIds: (pageIds) =>
              this.findVisiblePageIds(pageIds, split, this.PRIMARY_TIMEOUT_MS),
          },
          { from, size },
        ),
        this.PRIMARY_TIMEOUT_MS,
      );

      return result(
        pages.map(({ pageId, hits }) => ({
          data: { _id: pageId } as IPageWithSearchMeta['data'],
          meta: { attachmentHits: hits.map(toAttachmentHit) },
        })),
        false,
      );
    } catch (err) {
      logger.warn(
        { err, failure: failureKind(err) },
        'searchPrimaryAttachments: attachment search or permission check failed — returning empty + incomplete (fail-close)',
      );
      return result([], true);
    }
  }

  // --------------------------------------------------------------------------
  // resolveSecondary — enrichment phase after primary search
  // --------------------------------------------------------------------------

  /**
   * Resolves secondary enrichment data for page IDs supplied by the client.
   *
   * facet=attachments: primary already applied the permission gate — no-op.
   *
   * facet=all: the client-supplied ids are re-checked against the viewer and
   * the query's operators with searchAccessiblePages, then the attachments
   * index is searched for the surviving ids only. Any failure or a latency
   * above 500ms returns empty enrichments.
   *
   * @throws {RangeError} when the number of distinct primaryIds exceeds
   *   DEFAULT_PAGE_SIZE
   */
  async resolveSecondary(
    input: AttachmentSearchInput,
    options: {
      facet: 'all' | 'attachments';
      primaryIds: string[];
    },
  ): Promise<IResolvedSecondaryResult> {
    const { facet, primaryIds } = options;

    if (facet === 'attachments') {
      return { facet: 'attachments', enrichments: {} };
    }

    return this.resolveSecondaryAll(input, [...new Set(primaryIds)]);
  }

  private async resolveSecondaryAll(
    input: AttachmentSearchInput,
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
        this.doResolveSecondaryAll(splitInput(input), primaryIds),
        this.SECONDARY_TIMEOUT_MS,
      );
      return { facet: 'all', enrichments };
    } catch (err) {
      logger.warn(
        { err, failure: failureKind(err) },
        'resolveSecondaryAll: secondary enrichment failed — returning empty enrichments',
      );
      return { facet: 'all', enrichments: {} };
    }
  }

  private async doResolveSecondaryAll(
    split: SplitInput,
    primaryIds: string[],
  ): Promise<IResolvedSecondaryResult['enrichments']> {
    if (!hasPositiveKeyword(split.keywords)) {
      return {};
    }

    // The ids come from the client: re-check them for this viewer and query
    const visiblePageIds = await this.findVisiblePageIds(
      primaryIds,
      split,
      this.SECONDARY_TIMEOUT_MS,
    );
    const validIds = primaryIds.filter((id) => visiblePageIds.has(id));

    if (validIds.length === 0) {
      return {};
    }

    const searchBody = buildAttachmentsByPageIdsQuery(
      split.keywords,
      validIds,
      { highlight: true },
    );
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
