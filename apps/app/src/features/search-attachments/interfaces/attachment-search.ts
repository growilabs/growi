/**
 * DTO / interface definitions for the attachment full-text search feature.
 * This file is type-only — no runtime code is included.
 */

// ---- Extraction types ----

export interface ExtractedPage {
  readonly pageNumber: number | null;
  readonly label: string | null;
  readonly content: string;
}

/**
 * Discriminated union representing every possible outcome of a text-extraction
 * attempt against a single attachment file.
 */
export type ExtractionOutcome =
  | { kind: 'success'; pages: ExtractedPage[]; mimeType: string }
  | { kind: 'unsupported'; mimeType: string }
  | { kind: 'tooLarge'; fileSize: number }
  | { kind: 'timeout' }
  | { kind: 'serviceBusy' }
  | { kind: 'serviceUnreachable' }
  | { kind: 'encrypted' }
  | { kind: 'resourceLimit'; message: string }
  | { kind: 'failed'; reasonCode: string; message: string };

/**
 * What POST /_api/v3/attachments/:id/reextract answers: the outcome kind
 * only. The extracted text, file details and error messages stay on the
 * server (the caller may be an admin who cannot read the page).
 */
export type ReextractOutcomeSummary = {
  readonly kind: ExtractionOutcome['kind'];
};

export interface ReextractResponse {
  readonly outcome: ReextractOutcomeSummary;
}

// ---- Elasticsearch document shape ----

export interface IAttachmentEsDoc {
  readonly attachmentId: string;
  readonly pageId: string;
  readonly pageNumber: number | null;
  readonly label: string | null;
  readonly fileName: string;
  readonly originalName: string;
  readonly fileFormat: string;
  readonly fileSize: number;
  readonly attachmentType: string;
  readonly content: string;
  readonly created_at: string;
  readonly updated_at: string;
}

// ---- Search result types ----

export interface ISnippetSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

export interface IAttachmentHit {
  readonly attachmentId: string;
  readonly pageId: string;
  readonly fileName: string;
  readonly originalName: string;
  readonly fileFormat: string;
  readonly fileSize: number;
  readonly snippets: ISnippetSegment[];
  readonly pageNumber: number | null;
  readonly label: string | null;
}

export interface IPrimarySearchResult {
  readonly items: Array<{
    readonly pageId: string;
    readonly attachmentHits: IAttachmentHit[];
  }>;
  readonly meta: {
    /** null: no count is reported (it would count hits the viewer cannot see) */
    readonly total: number | null;
    readonly hitsCount: number;
    readonly took: number;
    readonly primaryResultIncomplete: boolean;
    readonly nextCursor: string | null;
  };
}

export interface ISecondarySearchResult {
  readonly attachmentHitsByPageId: Record<string, IAttachmentHit[]>;
}

// ---- Failure log ----

export interface ExtractionFailureEntry {
  readonly attachmentId: string;
  readonly pageId: string | null;
  readonly fileName: string;
  readonly fileFormat: string;
  readonly fileSize: number;
  readonly reasonCode:
    | 'unsupportedFormat'
    | 'fileTooLarge'
    | 'extractionTimeout'
    | 'serviceBusy'
    | 'serviceUnreachable'
    | 'fileEncrypted'
    | 'resourceLimitExceeded'
    | 'extractionFailed';
  readonly message: string | null;
  readonly occurredAt: Date;
}

// ---- Configuration ----

export interface AttachmentSearchConfig {
  readonly extractorUri: string | undefined;
  readonly hasExtractorToken: boolean;
  readonly timeoutMs: number;
  readonly maxFileSizeBytes: number;
  readonly isAttachmentFullTextSearchEnabled: boolean;
  readonly requiresReindex: boolean;
}

export interface AttachmentSearchConfigUpdate {
  readonly extractorUri?: string | null;
  readonly extractorToken?: string | null;
  readonly timeoutMs?: number;
  readonly maxFileSizeBytes?: number;
}
