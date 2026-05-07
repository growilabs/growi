import dns from 'node:dns/promises';
import { ErrorCode, postExtractExtractPost } from '@growi/markitdown-client';

import type {
  ExtractedPage,
  ExtractionOutcome,
} from '~/features/search-attachments/interfaces/attachment-search';
import type { IAttachmentDocument } from '~/server/models/attachment';
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:search-attachments:extractor');

/**
 * Cloud metadata IP literals blocked at DNS resolution time.
 * These addresses target cloud instance metadata services and must never
 * receive requests (SSRF prevention).
 */
const METADATA_IPS = new Set([
  '169.254.169.254', // AWS/GCP/Azure link-local metadata
  'fd00:ec2::254', // AWS IPv6 metadata
  '100.100.100.200', // Alibaba Cloud metadata
  '192.0.0.192', // GCP internal metadata
]);

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
 * Converts a readable stream to a Buffer by collecting all chunks.
 */
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

/**
 * Maps an Axios error response from the markitdown-extractor service to
 * an ExtractionOutcome discriminated union.
 *
 * Returns null when the error cannot be mapped (caller falls through to
 * the generic serviceUnreachable path).
 */
function mapAxiosErrorToOutcome(
  error: unknown,
  attachment: IAttachmentDocument,
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
        'markitdown-extractor returned 401 unauthorized',
      );
      return { kind: 'serviceUnreachable' };
    default:
      return null;
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
  attachment: IAttachmentDocument;
  buffer: Buffer;
  extractorUri: string;
  token: string;
  timeoutMs: number;
  isRetry: boolean;
};

/**
 * Sends the attachment bytes to the markitdown-extractor service and returns
 * an ExtractionOutcome. Always resolves (never throws).
 */
async function callExtractor(
  opts: CallExtractorOptions,
): Promise<ExtractionOutcome> {
  const { attachment, buffer, extractorUri, token, timeoutMs, isRetry } = opts;

  try {
    const response = await postExtractExtractPost(
      { file: buffer as unknown as string },
      {
        baseURL: extractorUri,
        headers: { Authorization: `Bearer ${token}` },
        timeout: timeoutMs,
      },
    );

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
 * markitdown-extractor microservice.
 *
 * Design guarantees:
 * - Always returns an ExtractionOutcome — never throws
 * - Reads the auth token fresh on every call (hot-reload safe)
 * - Blocks requests to cloud metadata IPs via DNS resolution check (SSRF defense)
 * - Retries 503 service_busy exactly once with exponential backoff + jitter
 * - Never logs the Bearer token value
 */
export class AttachmentTextExtractorService {
  constructor(
    private readonly fileUploader: {
      findDeliveryFile(
        attachment: IAttachmentDocument,
      ): Promise<NodeJS.ReadableStream>;
    },
  ) {}

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
        if (METADATA_IPS.has(resolved.address)) {
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
      const attachment = await Attachment.findById(attachmentId);
      if (attachment == null) {
        return {
          kind: 'failed',
          reasonCode: 'attachment_not_found',
          message: `Attachment not found: ${attachmentId}`,
        };
      }

      // --- Step 5: Fetch file bytes ---
      const stream = await this.fileUploader.findDeliveryFile(attachment);
      const buffer = await streamToBuffer(stream);

      // --- Step 6: Call extractor (with built-in retry for 503) ---
      return await callExtractor({
        attachment,
        buffer,
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
