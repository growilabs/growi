import dns from 'node:dns/promises';
import {
  ErrorCode,
  type PostExtractBody,
  postExtract,
} from '@growi/attachment-text-extractor-client';

import type {
  ExtractedPage,
  ExtractionOutcome,
} from '~/features/search-attachments/interfaces/attachment-search';
import type { AttachmentWithComputed } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import { AttachmentFileNotFoundError } from '~/server/service/file-uploader/attachment-file-not-found';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  type ConcurrencyLimit,
  createConcurrencyLimit,
} from './concurrency-limit';
import { buildExtractRequestBody } from './extract-request-body';
import { readFileChunks } from './read-file-chunks';
import {
  isCloudMetadataAddress,
  stripIpv6Brackets,
} from './validate-extractor-uri';

const logger = loggerFactory('growi:service:search-attachments:extractor');

/** reasonCode of a `failed` outcome whose stored file could not be read. */
export const FILE_READ_FAILED = 'file_read_failed';
/** reasonCode of a `failed` outcome whose stored file does not exist. */
export const FILE_NOT_FOUND = 'file_not_found';

// Retry configuration — exported for testability
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_JITTER_MAX_MS = 500;

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Extracted as a separate function so tests can control timing.
 */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const ERROR_CODES: readonly string[] = Object.values(ErrorCode);

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && ERROR_CODES.includes(value);

/**
 * Maps an Axios error response from the attachment-text-extractor service to
 * an ExtractionOutcome discriminated union.
 *
 * Returns null when the error cannot be mapped (caller falls through to
 * the generic serviceUnreachable path).
 */
function mapAxiosErrorToOutcome(
  error: unknown,
  attachment: AttachmentWithComputed,
): ExtractionOutcome | null {
  if (!isAxiosError(error) || error.response == null) {
    return null;
  }

  const { status, data } = error.response as {
    status: number;
    data: { code?: string; message?: string };
  };
  const code = data?.code;
  const message = data?.message ?? '';

  if (!isErrorCode(code)) {
    return null;
  }

  // No default: a code added to the client must fail to compile here
  switch (code) {
    case ErrorCode.unsupported_format:
      return { kind: 'unsupported', mimeType: attachment.fileFormat };
    case ErrorCode.file_too_large:
      return { kind: 'tooLarge', fileSize: attachment.fileSize };
    case ErrorCode.extraction_timeout:
      return { kind: 'timeout' };
    case ErrorCode.service_busy:
      // Caller handles retry; signal with a sentinel
      return { kind: 'serviceBusy' };
    case ErrorCode.file_encrypted:
      return { kind: 'encrypted' };
    case ErrorCode.resource_limit_exceeded:
      return { kind: 'resourceLimit', message };
    case ErrorCode.extraction_failed:
      return {
        kind: 'failed',
        reasonCode: ErrorCode.extraction_failed,
        message,
      };
    case ErrorCode.unauthorized:
      // Log at ERROR level but NEVER include the token value
      logger.error(
        { attachmentId: attachment._id, status },
        'attachment-text-extractor returned 401 unauthorized',
      );
      return { kind: 'serviceUnreachable' };
  }
}

/** Minimal type guard for Axios errors. */
function isAxiosError(
  error: unknown,
): error is { isAxiosError: true; response?: unknown; code?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isAxiosError?: boolean }).isAxiosError === true
  );
}

type CallExtractorOptions = {
  attachment: AttachmentWithComputed;
  body: PostExtractBody;
  extractorUri: string;
  token: string;
  timeoutMs: number;
  isRetry: boolean;
  /** Aborted once no one waits for the result: cancels the request and the retry. */
  signal?: AbortSignal;
};

/**
 * Sends the attachment bytes to the attachment-text-extractor service and returns
 * an ExtractionOutcome. Always resolves (never throws).
 */
async function callExtractor(
  opts: CallExtractorOptions,
): Promise<ExtractionOutcome> {
  const { attachment, body, extractorUri, token, timeoutMs, isRetry, signal } =
    opts;

  try {
    const response = await postExtract(body, {
      baseURL: extractorUri,
      headers: { Authorization: `Bearer ${token}` },
      timeout: timeoutMs,
      // A redirect could point the request at an internal address (SSRF)
      maxRedirects: 0,
      signal,
    });

    const pages: ExtractedPage[] = response.data.pages.map((p) => ({
      pageNumber: p.pageNumber,
      label: p.label,
      content: p.content,
    }));

    return { kind: 'success', pages, mimeType: response.data.mimeType };
  } catch (error) {
    const outcome = mapAxiosErrorToOutcome(error, attachment);

    if (outcome !== null) {
      // Handle 503 service_busy: retry once with exponential backoff + jitter
      if (outcome.kind === 'serviceBusy' && !isRetry && !signal?.aborted) {
        const delay =
          RETRY_BASE_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MAX_MS);
        await sleep(delay, signal);
        if (signal?.aborted) {
          return outcome;
        }
        return callExtractor({ ...opts, isRetry: true });
      }
      return outcome;
    }

    // Network-level errors (no response) or unmapped error codes
    return { kind: 'serviceUnreachable' };
  }
}

/**
 * Service that extracts text content from attachment files by delegating to the
 * attachment-text-extractor microservice.
 *
 * Design guarantees:
 * - Always returns an ExtractionOutcome — never throws
 * - Reads the auth token fresh on every call (hot-reload safe)
 * - Blocks requests to cloud metadata IPs via DNS resolution check (SSRF defense)
 * - Retries 503 service_busy exactly once with exponential backoff + jitter
 * - Never logs the Bearer token value
 * - Holds at most `maxConcurrentExtractions` files in memory at a time
 */
type DeliveryFileFinder = {
  findDeliveryFile(
    attachment: AttachmentWithComputed,
  ): Promise<NodeJS.ReadableStream>;
};

/**
 * The extractor's default MAX_CONCURRENCY: a GROWI process sending more at
 * once would only get service_busy answers back, while each waiting request
 * would already hold its whole file in memory.
 */
const DEFAULT_MAX_CONCURRENT_EXTRACTIONS = 3;

export class AttachmentTextExtractorService {
  private readonly fileUploader: DeliveryFileFinder;

  // One instance per process (see initAttachmentFullTextSearch), so uploads,
  // re-extractions and a rebuild all share this limit.
  private readonly limit: ConcurrencyLimit;

  constructor(
    fileUploader: DeliveryFileFinder,
    {
      maxConcurrentExtractions = DEFAULT_MAX_CONCURRENT_EXTRACTIONS,
    }: { maxConcurrentExtractions?: number } = {},
  ) {
    this.fileUploader = fileUploader;
    this.limit = createConcurrencyLimit(maxConcurrentExtractions);
  }

  /**
   * `signal`: once aborted, an extraction still waiting for a slot returns
   * `timeout` without reading the file (its caller no longer waits for it).
   */
  async extractAttachment(
    attachmentId: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<ExtractionOutcome> {
    try {
      // --- Step 1: Load config (fresh read every call for hot-reload safety) ---
      const extractorUri = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorUri',
      ) as string | undefined;

      if (!extractorUri) {
        return { kind: 'serviceUnreachable' };
      }

      // --- Step 2: Check auth token ---
      // A header value cannot carry surrounding whitespace (e.g. the newline
      // a token read from a secret file ends in).
      const extractorToken = configManager
        .getConfig('app:attachmentFullTextSearch:extractorToken')
        ?.trim();

      if (!extractorToken) {
        return { kind: 'serviceUnreachable' };
      }

      const timeoutMs = configManager.getConfig(
        'app:attachmentFullTextSearch:timeoutMs',
      ) as number;

      // --- Step 3: DNS rebinding check ---
      let hostname: string;
      try {
        hostname = stripIpv6Brackets(new URL(extractorUri).hostname);
      } catch {
        return { kind: 'serviceUnreachable' };
      }

      try {
        const resolved = await dns.lookup(hostname);
        if (isCloudMetadataAddress(resolved.address)) {
          logger.warn(
            { hostname, resolvedAddress: resolved.address },
            'Blocked request to metadata IP via DNS rebinding',
          );
          return { kind: 'serviceUnreachable' };
        }
      } catch {
        // DNS resolution failure — cannot safely proceed
        return { kind: 'serviceUnreachable' };
      }

      // --- Step 4: Load attachment document ---
      const attachment = await prisma.attachments.findUnique({
        where: { id: attachmentId },
      });
      if (attachment == null) {
        return {
          kind: 'failed',
          reasonCode: 'attachment_not_found',
          message: `Attachment not found: ${attachmentId}`,
        };
      }

      // --- Step 5: Skip oversized files before reading them into memory ---
      const maxFileSizeBytes = configManager.getConfig(
        'app:attachmentFullTextSearch:maxFileSizeBytes',
      );
      if (attachment.fileSize > maxFileSizeBytes) {
        return { kind: 'tooLarge', fileSize: attachment.fileSize };
      }

      // The slot is held from reading the file to the last answer, retry included
      return await this.limit(() =>
        signal?.aborted
          ? Promise.resolve<ExtractionOutcome>({ kind: 'timeout' })
          : this.readAndExtract(attachment, {
              extractorUri,
              token: extractorToken,
              timeoutMs,
              signal,
            }),
      );
    } catch (error) {
      // Catch-all: ensure the method never throws regardless of what goes wrong
      logger.error(
        { attachmentId, error },
        'Unexpected error in extractAttachment',
      );
      return { kind: 'serviceUnreachable' };
    }
  }

  /** Steps 6–7; never throws (callExtractor resolves every outcome). */
  private async readAndExtract(
    attachment: AttachmentWithComputed,
    settings: Pick<
      CallExtractorOptions,
      'extractorUri' | 'token' | 'timeoutMs' | 'signal'
    >,
  ): Promise<ExtractionOutcome> {
    // --- Step 6: Fetch file bytes ---
    let body: PostExtractBody;
    try {
      // The chunks are not kept in a variable, so only the body's copy
      // stays in memory while the request runs.
      body = buildExtractRequestBody(
        await readFileChunks(
          () => this.fileUploader.findDeliveryFile(attachment),
          settings,
        ),
        attachment,
      );
    } catch (error) {
      logger.warn(
        { attachmentId: attachment.id, error },
        'Failed to read the stored file',
      );
      // A missing file is a fact about this file; any other read failure
      // (no answer, timeout, denied) is the storage's and counts towards a
      // rebuild's outage limit (see attachment-reindex-batch).
      return error instanceof AttachmentFileNotFoundError
        ? {
            kind: 'failed',
            reasonCode: FILE_NOT_FOUND,
            message: 'The stored file does not exist',
          }
        : {
            kind: 'failed',
            reasonCode: FILE_READ_FAILED,
            message: 'The stored file could not be read',
          };
    }

    // --- Step 7: Call extractor (with built-in retry for 503) ---
    return callExtractor({ attachment, body, ...settings, isRetry: false });
  }
}
