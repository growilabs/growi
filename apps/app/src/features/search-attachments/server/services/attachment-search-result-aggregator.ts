/**
 * AttachmentSearchResultAggregator
 *
 * Implements the priority-slot-driven search model:
 * - facet=pages  : existing page search only (attachments_index not touched)
 * - facet=all    : from==0: page search, then attachments of the pages it
 *                  shows content of; from>0: pages-only
 * - facet=attachments: attachment index primary, then searchAccessiblePages on page_index
 *
 * Page items always come from the regular page search pipeline (search +
 * result formatting), so they carry exactly what `/_api/search` returns.
 * An attachment hit is returned only when page search would show the same
 * viewer the content of its parent page:
 * - facet=all first page: decided from the page result items themselves
 *   (page search already applied the viewer filter and the operators, and its
 *   items carry the MongoDB documents it judged snippets by); only those
 *   pages' attachments are searched, so no hidden hit can take a slot
 * - every other path: searchAccessiblePages for the viewer and the query's
 *   operators; any failure there drops the hits (fail-close)
 * Only the keyword part of the query is matched against attachment content.
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
import { canShowSnippetOfPage } from '~/server/service/search/can-show-snippet';
import loggerFactory from '~/utils/logger';

import { buildAttachmentSearchQuery } from '../queries/build-attachment-search-query';
import {
  buildAttachmentsByPageIdsQuery,
  DEFAULT_PAGE_SIZE,
  PAGE_HITS,
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
  };
  highlight?: {
    content?: string[];
    'content.ja'?: string[];
    'content.en'?: string[];
    fileName?: string[];
    originalName?: string[];
  };
  /** Set on the collapsed hits of buildAttachmentsByPageIdsQuery. */
  inner_hits?: Record<string, { hits: { hits: AttachmentEsHit[] } }>;
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
    /** facet=attachments: the attachment search or the permission check failed. */
    primaryResultIncomplete?: boolean;
  };
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

/**
 * The ids of the page result items whose content page search showed the
 * viewer, by the same rule on the same MongoDB documents. An item without
 * grant data is not a page document and is dropped (fail-close).
 */
const snippetVisiblePageIds = (
  items: readonly IPageWithSearchMeta[],
  { user, userGroups }: AttachmentSearchViewer,
): Set<string> =>
  new Set(
    items
      .filter(
        ({ data }) =>
          data.grant !== undefined &&
          canShowSnippetOfPage(data, user, userGroups),
      )
      .map(pageIdOf),
  );

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
      facet: 'all' | 'attachments';
      from: number;
      size: number;
    },
  ): Promise<IPrimarySearchResult> {
    const { facet, from, size } = options;

    if (facet === 'all') {
      // from>0: only page search (same as facet=pages), no attachment query
      if (from > 0) {
        return await this.searchPrimaryPages(input, from, size);
      }
      return await this.searchPrimaryAll(input, size);
    }

    return await this.searchPrimaryAttachments(input, from, size);
  }

  // --------------------------------------------------------------------------
  // Permission gate for facet=attachments and the secondary phase
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
  // Attachment hits on pages already judged visible
  // --------------------------------------------------------------------------

  /**
   * The attachment hits on `pageIds`, which the caller has already judged
   * visible for the viewer and the query, keyed by page id.
   */
  private async searchHitsOnPages(
    keywords: AttachmentKeywordTerms,
    pageIds: readonly string[],
  ): Promise<Map<string, IAttachmentHit[]>> {
    const hitsByPageId = new Map<string, IAttachmentHit[]>();
    if (!hasPositiveKeyword(keywords) || pageIds.length === 0) {
      return hitsByPageId;
    }

    const chunks: string[][] = [];
    for (let i = 0; i < pageIds.length; i += DEFAULT_PAGE_SIZE) {
      chunks.push(pageIds.slice(i, i + DEFAULT_PAGE_SIZE));
    }
    const responses = await Promise.all(
      chunks.map((ids) =>
        this.attachmentClient.searchAttachments(
          buildAttachmentsByPageIdsQuery(keywords, ids),
        ),
      ),
    );

    const allowed = new Set(pageIds);
    const hits = responses
      .flatMap((r) => r.hits.hits)
      .flatMap((group) => group.inner_hits?.[PAGE_HITS]?.hits.hits ?? []);
    for (const hit of hits) {
      const pageId = hit._source.pageId;
      // The query filters by these ids; this re-check keeps the gate
      // independent of that query being correct.
      if (!allowed.has(pageId)) continue;
      hitsByPageId.set(pageId, [
        ...(hitsByPageId.get(pageId) ?? []),
        toAttachmentHit(hit),
      ]);
    }
    return hitsByPageId;
  }

  // --------------------------------------------------------------------------
  // facet=all, from==0 — page search, then the attachments of its pages
  // --------------------------------------------------------------------------

  /**
   * The safety net bounds the page search and the attachment search together
   * from the start of the request; past it the page result is returned alone.
   */
  private async searchPrimaryAll(
    input: AttachmentSearchInput,
    size: number,
  ): Promise<IPrimarySearchResult> {
    const split = splitInput(input);
    const pageSearchPromise = this.pageSearchFn(input, { from: 0, size });
    let gaveUp = false;
    const attachmentHitsPromise = (async () => {
      // A page search failure is reported by the await below, not here
      const pageResult = await pageSearchPromise.catch(() => null);
      if (pageResult == null || gaveUp) {
        return new Map<string, IAttachmentHit[]>();
      }
      return this.searchHitsOnPages(split.keywords, [
        ...snippetVisiblePageIds(pageResult.data, input.viewer),
      ]);
    })();

    let attachmentHitsByPageId: Map<string, IAttachmentHit[]> | null = null;
    try {
      attachmentHitsByPageId = await withTimeout(
        attachmentHitsPromise,
        this.PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      gaveUp = true;
      logger.warn(
        { err, failure: failureKind(err) },
        'searchPrimaryAll: primary search failed — degrading to pages-only',
      );
    }

    // A failed page search fails the request, as on every other path
    const pageResult = await pageSearchPromise;
    const hitsByPageId = attachmentHitsByPageId;
    const items =
      hitsByPageId == null
        ? pageResult.data
        : pageResult.data.map((item) => {
            const attachmentHits = hitsByPageId.get(pageIdOf(item));
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

    // Stops the collector once this request has its answer (or timed out)
    const collecting = new AbortController();
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
          { from, size, signal: collecting.signal },
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
    } finally {
      collecting.abort();
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
    const hitsByPageId = await this.searchHitsOnPages(
      split.keywords,
      primaryIds.filter((id) => visiblePageIds.has(id)),
    );

    return Object.fromEntries(
      [...hitsByPageId].map(([pageId, attachmentHits]) => [
        pageId,
        { attachmentHits },
      ]),
    );
  }
}
