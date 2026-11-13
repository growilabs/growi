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
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { buildExtractRequestBody } from './extract-request-body';
import { isCloudMetadataAddress } from './validate-extractor-uri';

const logger = loggerFactory('growi:service:search-attachments:extractor');

// Retry configuration — exported for testability
export const RETRY_BASE_DELAY_MS = 500;
export const RETRY_JITTER_MAX_MS = 500;

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Extracted as a separate function so tests can control timing.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Collects the chunks of a readable stream. They are not joined: the request
 * body copies them once, and a joined Buffer would be a second copy.
 */
async function streamToChunks(
  stream: NodeJS.ReadableStream,
): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return chunks;
}

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
};

/**
 * Sends the attachment bytes to the attachment-text-extractor service and returns
 * an ExtractionOutcome. Always resolves (never throws).
 */
async function callExtractor(
  opts: CallExtractorOptions,
): Promise<ExtractionOutcome> {
  const { attachment, body, extractorUri, token, timeoutMs, isRetry } = opts;

  try {
    const response = await postExtract(body, {
      baseURL: extractorUri,
      headers: { Authorization: `Bearer ${token}` },
      timeout: timeoutMs,
      // A redirect could point the request at an internal address (SSRF)
      maxRedirects: 0,
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
      if (outcome.kind === 'serviceBusy' && !isRetry) {
        const delay =
          RETRY_BASE_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MAX_MS);
        await sleep(delay);
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
 */
type DeliveryFileFinder = {
  findDeliveryFile(
    attachment: AttachmentWithComputed,
  ): Promise<NodeJS.ReadableStream>;
};

export class AttachmentTextExtractorService {
  private readonly fileUploader: DeliveryFileFinder;

  constructor(fileUploader: DeliveryFileFinder) {
    this.fileUploader = fileUploader;
  }

  async extractAttachment(attachmentId: string): Promise<ExtractionOutcome> {
    try {
      // --- Step 1: Load config (fresh read every call for hot-reload safety) ---
      const extractorUri = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorUri',
      ) as string | undefined;

      if (!extractorUri) {
        return { kind: 'serviceUnreachable' };
      }

      // --- Step 2: Check auth token ---
      const extractorToken = configManager.getConfig(
        'app:attachmentFullTextSearch:extractorToken',
      ) as string | undefined;

      if (!extractorToken) {
        return { kind: 'serviceUnreachable' };
      }

      const timeoutMs = configManager.getConfig(
        'app:attachmentFullTextSearch:timeoutMs',
      ) as number;

      // --- Step 3: DNS rebinding check ---
      let hostname: string;
      try {
        hostname = new URL(extractorUri).hostname;
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

      // --- Step 6: Fetch file bytes ---
      const stream = await this.fileUploader.findDeliveryFile(attachment);
      // The chunks are not kept in a variable, so only the body's copy stays
      // in memory while the request runs.
      const body = buildExtractRequestBody(
        await streamToChunks(stream),
        attachment,
      );

      // --- Step 7: Call extractor (with built-in retry for 503) ---
      return await callExtractor({
        attachment,
        body,
        extractorUri,
        token: extractorToken,
        timeoutMs,
        isRetry: false,
      });
    } catch (error) {
      // Catch-all: ensure the method never throws regardless of what goes wrong
      logger.error(
        { attachmentId, error },
        'Unexpected error in extractAttachment',
      );
      return { kind: 'serviceUnreachable' };
    }
  }
}
