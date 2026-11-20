/**
 * AttachmentSearchResultAggregator
 *
 * - searchPrimary: facet=attachments — the attachment index searched first,
 *   then searchAccessiblePages on page_index for the parent pages
 * - resolveSecondary: the attachment hits of pages the client got from the
 *   page search
 *
 * An attachment hit is returned only when page search would show the same
 * viewer the content of its parent page (searchAccessiblePages for the viewer
 * and the query's operators); any failure there drops the hits (fail-close).
 * searchPrimary reports such a failure in its result; resolveSecondary throws.
 * Only the keyword part of the query is matched against attachment content.
 */

import type { IAttachmentHit } from '~/features/search-attachments/interfaces/attachment-search';
import type { IPageWithSearchMeta } from '~/interfaces/search';
import type {
  QueryTerms,
  ResolvedFilterData,
} from '~/server/interfaces/search';
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

/** facet=attachments: attachment hits in score order, grouped by parent page. */
export interface IPrimarySearchResult {
  /** `{ data: { _id: pageId }, meta: { attachmentHits } }` per parent page */
  items: IPageWithSearchMeta[];
  meta: {
    /** true only when the attachment search or the permission check failed */
    primaryResultIncomplete: boolean;
  };
}

/**
 * Result of resolveSecondary — enrichment data keyed by pageId.
 */
export interface IResolvedSecondaryResult {
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
  private readonly attachmentClient: AttachmentIndexClient;
  private readonly PRIMARY_TIMEOUT_MS: number;
  private readonly SECONDARY_TIMEOUT_MS: number;

  constructor(
    attachmentClient: AttachmentIndexClient,
    PRIMARY_TIMEOUT_MS = 800,
    SECONDARY_TIMEOUT_MS = DEFAULT_SECONDARY_TIMEOUT_MS,
  ) {
    this.attachmentClient = attachmentClient;
    this.PRIMARY_TIMEOUT_MS = PRIMARY_TIMEOUT_MS;
    this.SECONDARY_TIMEOUT_MS = SECONDARY_TIMEOUT_MS;
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

    const response = await this.attachmentClient.searchAttachments(
      buildAttachmentsByPageIdsQuery(keywords, [...pageIds]),
    );

    const allowed = new Set(pageIds);
    const hits = response.hits.hits.flatMap(
      (group) => group.inner_hits?.[PAGE_HITS]?.hits.hits ?? [],
    );
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
  // facet=attachments — attachment index primary + permission gate
  // --------------------------------------------------------------------------

  /**
   * Nothing in the response may depend on hits the viewer cannot see: no
   * total is reported, and `primaryResultIncomplete` is set only when the
   * attachment search or the permission check failed (past
   * PRIMARY_TIMEOUT_MS included). Paging follows collectVisibleAttachmentHits.
   */
  async searchPrimary(
    input: AttachmentSearchInput,
    { from, size }: { from: number; size: number },
  ): Promise<IPrimarySearchResult> {
    const result = (
      items: IPageWithSearchMeta[],
      primaryResultIncomplete: boolean,
    ): IPrimarySearchResult => ({ items, meta: { primaryResultIncomplete } });

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
        'searchPrimary: attachment search or permission check failed — returning empty + incomplete (fail-close)',
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
   * Resolves the attachment hits for page IDs supplied by the client: the ids
   * are re-checked against the viewer and the query's operators with
   * searchAccessiblePages, then the attachments index is searched for the
   * surviving ids only. A query without a positive keyword has no hits.
   *
   * @throws {RangeError} when the number of distinct primaryIds exceeds
   *   DEFAULT_PAGE_SIZE
   * @throws when the permission check or the attachment search fails, or the
   *   whole resolution exceeds the secondary time limit
   *   (AttachmentSearchTimeoutError); an empty result is never returned for a
   *   failure
   */
  async resolveSecondary(
    input: AttachmentSearchInput,
    { primaryIds }: { primaryIds: string[] },
  ): Promise<IResolvedSecondaryResult> {
    const distinctIds = [...new Set(primaryIds)];
    if (distinctIds.length > DEFAULT_PAGE_SIZE) {
      throw new RangeError(
        `primaryIds.length (${distinctIds.length}) exceeds the maximum allowed page size (${DEFAULT_PAGE_SIZE}). ` +
          'Split the request into smaller batches.',
      );
    }

    return {
      enrichments: await withTimeout(
        this.doResolveSecondary(splitInput(input), distinctIds),
        this.SECONDARY_TIMEOUT_MS,
      ),
    };
  }

  private async doResolveSecondary(
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
