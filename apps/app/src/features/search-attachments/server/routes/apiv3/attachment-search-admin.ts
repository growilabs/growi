/**
 * Admin API endpoints for attachment full-text search configuration.
 *
 * GET  /_api/v3/admin/attachment-search/config  — read current config values
 * PUT  /_api/v3/admin/attachment-search/config  — update config values
 *
 * Security note: `extractorToken` is WRITE-ONLY and must never appear in
 * GET responses.  Only `hasExtractorToken: boolean` is exposed.
 */

import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import { body } from 'express-validator';

import { validateExtractorUri } from '~/features/search-attachments/server/services/validate-extractor-uri';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:search-attachments:routes:apiv3:admin',
);

// ---------------------------------------------------------------------------
// RequiresReindex cache
// ---------------------------------------------------------------------------

/** 30-second TTL for the requiresReindex computation. */
const CACHE_TTL_MS = 30_000;

interface RequiresReindexCache {
  value: boolean;
  computedAt: number;
}

let requiresReindexCache: RequiresReindexCache | null = null;

/** Invalidate the requiresReindex cache (call after a successful PUT). */
export const invalidateRequiresReindexCache = (): void => {
  requiresReindexCache = null;
};

/**
 * Computes whether the attachment ES index is out of sync with MongoDB.
 *
 * Returns `false` immediately when:
 * - attachment full-text search is not enabled (no extractorUri set)
 * - MongoDB has 0 attachments (nothing to index)
 *
 * Otherwise runs a cardinality aggregation on the `attachments` ES index and
 * compares the unique-attachmentId count against `Attachment.countDocuments()`.
 *
 * Result is cached for CACHE_TTL_MS milliseconds.
 */
export const computeRequiresReindex = async (
  crowi: Crowi,
  isEnabled: boolean,
): Promise<boolean> => {
  // Cache hit
  if (
    requiresReindexCache !== null &&
    Date.now() - requiresReindexCache.computedAt < CACHE_TTL_MS
  ) {
    return requiresReindexCache.value;
  }

  let value = false;

  if (isEnabled) {
    try {
      const { Attachment } = await import('~/server/models/attachment');
      const mongoCount = await Attachment.countDocuments();

      if (mongoCount > 0) {
        // Access the ES client via the search service delegator.
        // fullTextSearchDelegator is typed as `any & ElasticsearchDelegator`, so
        // we can reach the private `client` field at runtime.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegator: any = crowi.searchService?.fullTextSearchDelegator;
        const esClient = delegator?.client;

        if (esClient != null && typeof esClient.search === 'function') {
          const result = await esClient.search({
            index: 'attachments',
            body: {
              size: 0,
              aggs: {
                unique_attachments: {
                  cardinality: { field: 'attachmentId' },
                },
              },
            },
          });

          // ES7 returns `result.body.aggregations`, ES8/ES9 return `result.aggregations`
          const aggs = result?.aggregations ?? result?.body?.aggregations;
          const esCount: number =
            (aggs?.unique_attachments?.value as number) ?? 0;
          value = mongoCount > esCount;
        }
      }
    } catch (err) {
      logger.error({ err }, 'computeRequiresReindex: ES query failed');
      // On error, do not cache; return false conservatively
      return false;
    }
  }

  requiresReindexCache = { value, computedAt: Date.now() };
  return value;
};

// ---------------------------------------------------------------------------
// Response DTO
// ---------------------------------------------------------------------------

export interface AttachmentSearchConfig {
  extractorUri: string | null;
  hasExtractorToken: boolean;
  timeoutMs: number;
  maxFileSizeBytes: number;
  isAttachmentFullTextSearchEnabled: boolean;
  requiresReindex: boolean;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const putConfigValidator = [
  body('extractorUri')
    .optional({ nullable: true })
    .custom((value) => {
      // null / empty string → soft-disable (allowed)
      if (value == null || value === '') return true;
      const result = validateExtractorUri(value);
      if (!result.ok) {
        throw new Error(result.reason);
      }
      return true;
    }),
  body('extractorToken').optional({ nullable: true }),
  body('timeoutMs').optional({ nullable: true }).isInt({ min: 1 }),
  body('maxFileSizeBytes').optional({ nullable: true }).isInt({ min: 1 }),
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const attachmentSearchAdminFactory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  // -------------------------------------------------------------------------
  // GET /config
  // -------------------------------------------------------------------------
  router.get(
    '/config',
    accessTokenParser([SCOPE.READ.ADMIN.FULL_TEXT_SEARCH]),
    loginRequiredStrictly,
    adminRequired,
    async (_req, res: ApiV3Response) => {
      try {
        const extractorUri =
          configManager.getConfig(
            'app:attachmentFullTextSearch:extractorUri',
          ) ?? null;

        const tokenValue = configManager.getConfig(
          'app:attachmentFullTextSearch:extractorToken',
        );
        // SECURITY: hasExtractorToken is a boolean only — the token value must
        // never be included in the response.
        const hasExtractorToken = tokenValue != null && tokenValue !== '';

        const timeoutMs = configManager.getConfig(
          'app:attachmentFullTextSearch:timeoutMs',
        );
        const maxFileSizeBytes = configManager.getConfig(
          'app:attachmentFullTextSearch:maxFileSizeBytes',
        );

        const isAttachmentFullTextSearchEnabled =
          extractorUri != null && extractorUri !== '';

        const requiresReindex = await computeRequiresReindex(
          crowi,
          isAttachmentFullTextSearchEnabled,
        );

        const config: AttachmentSearchConfig = {
          extractorUri,
          hasExtractorToken,
          timeoutMs,
          maxFileSizeBytes,
          isAttachmentFullTextSearchEnabled,
          requiresReindex,
        };

        return res.apiv3({ config });
      } catch (err) {
        logger.error({ err }, 'GET /config failed');
        return res.apiv3Err(
          new ErrorV3('Failed to retrieve attachment search config'),
          500,
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // PUT /config
  // -------------------------------------------------------------------------
  router.put(
    '/config',
    accessTokenParser([SCOPE.WRITE.ADMIN.FULL_TEXT_SEARCH]),
    loginRequiredStrictly,
    adminRequired,
    putConfigValidator,
    apiV3FormValidator,
    async (req, res: ApiV3Response) => {
      try {
        const { extractorUri, extractorToken, timeoutMs, maxFileSizeBytes } =
          req.body as {
            extractorUri?: string | null;
            extractorToken?: string | null;
            timeoutMs?: number;
            maxFileSizeBytes?: number;
          };

        // Validate URI explicitly (covers non-empty strings bypassed by express-validator custom)
        if (extractorUri != null && extractorUri !== '') {
          const uriResult = validateExtractorUri(extractorUri);
          if (!uriResult.ok) {
            return res.apiv3Err(
              new ErrorV3(
                `Invalid extractor URI: ${uriResult.reason}`,
                'invalid_extractor_uri',
              ),
              400,
            );
          }
        }

        const updates: Partial<Record<string, unknown>> = {};

        if ('extractorUri' in req.body) {
          // null / empty → undefined (soft-disable)
          updates['app:attachmentFullTextSearch:extractorUri'] =
            extractorUri != null && extractorUri !== ''
              ? extractorUri
              : undefined;
        }

        if ('extractorToken' in req.body) {
          // null → delete (use removeIfUndefined option)
          updates['app:attachmentFullTextSearch:extractorToken'] =
            extractorToken != null && extractorToken !== ''
              ? extractorToken
              : undefined;
        }

        if ('timeoutMs' in req.body && timeoutMs != null) {
          updates['app:attachmentFullTextSearch:timeoutMs'] = timeoutMs;
        }

        if ('maxFileSizeBytes' in req.body && maxFileSizeBytes != null) {
          updates['app:attachmentFullTextSearch:maxFileSizeBytes'] =
            maxFileSizeBytes;
        }

        await configManager.updateConfigs(
          updates as Parameters<typeof configManager.updateConfigs>[0],
          { removeIfUndefined: true },
        );

        // Invalidate requiresReindex cache so next GET recomputes
        invalidateRequiresReindexCache();

        return res.apiv3({});
      } catch (err) {
        logger.error({ err }, 'PUT /config failed');
        return res.apiv3Err(
          new ErrorV3('Failed to update attachment search config'),
          500,
        );
      }
    },
  );

  return router;
};
