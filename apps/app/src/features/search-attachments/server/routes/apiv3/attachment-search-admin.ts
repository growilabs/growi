/**
 * Admin API endpoints for attachment full-text search configuration.
 *
 * GET  /_api/v3/admin/attachment-search/config    — read current config values
 *      (`useOnlyEnvVars`: true when the 4 keys are pinned by environment variables)
 * PUT  /_api/v3/admin/attachment-search/config    — update config values
 *      (409 `config_locked_by_env_vars` while the settings are pinned by
 *      environment variables; nothing is saved)
 * GET  /_api/v3/admin/attachment-search/failures  — list recent extraction failures
 *
 * Every route: accessTokenParser([SCOPE.*.ADMIN.FULL_TEXT_SEARCH]) +
 * loginRequiredStrictly + adminRequired. Not behind the feature gate: these
 * are how an admin turns the feature on. PUT adds addActivity after
 * adminRequired (rules/activity-recording.md): a success records
 * ACTION_ADMIN_ATTACHMENT_SEARCH_SETTINGS_UPDATE, a refusal or failure
 * ACTION_UNSETTLED.
 *
 * Security note: `extractorToken` is WRITE-ONLY and must never appear in
 * GET responses.  Only `hasExtractorToken: boolean` is exposed.
 */

import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import { body, query } from 'express-validator';

import type { AttachmentSearchConfig } from '~/features/search-attachments/interfaces/attachment-search';
import { ExtractionFailureLogService } from '~/features/search-attachments/server/services/extraction-failure-log-service';
import { indexableAttachments } from '~/features/search-attachments/server/services/indexable-attachments';
import { isAttachmentFullTextSearchEnabled } from '~/features/search-attachments/server/services/is-attachment-full-text-search-enabled';
import { validateExtractorUri } from '~/features/search-attachments/server/services/validate-extractor-uri';
import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
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

const isIndexNotFound = (err: unknown): boolean =>
  (err as { meta?: { body?: { error?: { type?: string } } } })?.meta?.body
    ?.error?.type === 'index_not_found_exception';

/**
 * Computes whether the attachment ES index is out of sync with MongoDB.
 *
 * Returns `false` immediately when:
 * - attachment full-text search is not enabled
 * - MongoDB has no indexable attachments (nothing to index)
 *
 * Otherwise runs a cardinality aggregation on the attachment alias and
 * compares the unique-attachmentId count against the indexable attachments.
 * Returns `true` when the alias does not exist yet.
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
      const { prisma } = await import('~/utils/prisma');
      const mongoCount = await prisma.attachments.count({
        where: indexableAttachments,
      });

      if (mongoCount > 0) {
        // Access the ES client via the search service delegator.
        // fullTextSearchDelegator is typed as `any & ElasticsearchDelegator`, so
        // we can reach the private `client` field at runtime.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegator: any = crowi.searchService?.fullTextSearchDelegator;
        const esClient = delegator?.client;
        const aliasName = crowi.attachmentIndexOperations?.aliasName;

        if (
          esClient != null &&
          aliasName != null &&
          typeof esClient.search === 'function'
        ) {
          const result = await esClient.search({
            index: aliasName,
            body: {
              size: 0,
              aggs: {
                unique_attachments: {
                  cardinality: { field: 'attachmentId' },
                },
              },
            },
          });

          const aggs = result?.aggregations;
          const esCount: number =
            (aggs?.unique_attachments?.value as number) ?? 0;
          value = mongoCount > esCount;
        }
      }
    } catch (err) {
      if (!isIndexNotFound(err)) {
        logger.error({ err }, 'computeRequiresReindex: ES query failed');
        // On error, do not cache; return false conservatively
        return false;
      }
      // Enabled but the alias is missing: prompt the admin to rebuild
      value = true;
    }
  }

  requiresReindexCache = { value, computedAt: Date.now() };
  return value;
};

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** Bounds of PUT /config; the defaults are 90 s and 50 MiB (config-definition). */
const TIMEOUT_MS_MIN = 1_000;
const TIMEOUT_MS_MAX = 600_000;
const MAX_FILE_SIZE_BYTES_MAX = 500 * 1024 * 1024;
const EXTRACTOR_TOKEN_MAX_LENGTH = 1024;

// Runs before the validators so no input, valid or not, can reach the save
// path while the environment variables win (research.md 14.5).
const refuseWhenPinnedByEnvVars: express.RequestHandler = (
  _req,
  res: ApiV3Response,
  next,
) => {
  if (
    configManager.getConfig('env:useOnlyEnvVars:app:attachmentFullTextSearch')
  ) {
    return res.apiv3Err(
      new ErrorV3(
        'Attachment full-text search settings are pinned by environment variables and cannot be changed here',
        'config_locked_by_env_vars',
      ),
      409,
    );
  }
  return next();
};

const putConfigValidator = [
  // The URI itself is checked in the handler, which answers invalid_extractor_uri
  body('extractorUri')
    .optional({ nullable: true })
    .isString()
    .withMessage('extractorUri must be a string or null'),
  body('extractorToken')
    .optional({ nullable: true })
    .isString()
    .withMessage('extractorToken must be a string or null')
    .bail()
    .isLength({ max: EXTRACTOR_TOKEN_MAX_LENGTH })
    .withMessage(
      `extractorToken must be at most ${EXTRACTOR_TOKEN_MAX_LENGTH} characters`,
    ),
  body('timeoutMs')
    .optional({ nullable: true })
    .isInt({ min: TIMEOUT_MS_MIN, max: TIMEOUT_MS_MAX })
    .withMessage(
      `timeoutMs must be an integer between ${TIMEOUT_MS_MIN} and ${TIMEOUT_MS_MAX}`,
    )
    .toInt(),
  body('maxFileSizeBytes')
    .optional({ nullable: true })
    .isInt({ min: 1, max: MAX_FILE_SIZE_BYTES_MAX })
    .withMessage(
      `maxFileSizeBytes must be an integer between 1 and ${MAX_FILE_SIZE_BYTES_MAX}`,
    )
    .toInt(),
];

/** Upper bound of GET /failures `limit`. */
const MAX_FAILURES_LIMIT = 200;

const listFailuresValidator = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: MAX_FAILURES_LIMIT })
    .withMessage(`limit must be an integer between 1 and ${MAX_FAILURES_LIMIT}`)
    .toInt(),
  query('since')
    .optional()
    .isISO8601()
    .withMessage('since must be an ISO 8601 date'),
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const attachmentSearchAdminFactory = (crowi: Crowi): express.Router => {
  const router = express.Router();

  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();
  const activityEvent = crowi.events.activity;

  const failureLogService = new ExtractionFailureLogService();

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
        const hasExtractorToken =
          tokenValue != null && tokenValue.trim() !== '';

        const timeoutMs = configManager.getConfig(
          'app:attachmentFullTextSearch:timeoutMs',
        );
        const maxFileSizeBytes = configManager.getConfig(
          'app:attachmentFullTextSearch:maxFileSizeBytes',
        );

        const useOnlyEnvVars = configManager.getConfig(
          'env:useOnlyEnvVars:app:attachmentFullTextSearch',
        );

        const isEnabled = isAttachmentFullTextSearchEnabled(
          crowi.searchService?.isConfigured === true,
        );

        const requiresReindex = await computeRequiresReindex(crowi, isEnabled);

        const config: AttachmentSearchConfig = {
          extractorUri,
          hasExtractorToken,
          timeoutMs,
          maxFileSizeBytes,
          isAttachmentFullTextSearchEnabled: isEnabled,
          requiresReindex,
          useOnlyEnvVars,
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
    addActivity,
    refuseWhenPinnedByEnvVars,
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
          // null, '' or whitespace only → delete (removeIfUndefined option)
          updates['app:attachmentFullTextSearch:extractorToken'] =
            extractorToken?.trim() || undefined;
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

        // Enabling at runtime needs the index without a restart
        if (
          isAttachmentFullTextSearchEnabled(
            crowi.searchService?.isConfigured === true,
          )
        ) {
          try {
            await crowi.attachmentIndexOperations?.ensureAttachmentIndex();
          } catch (err) {
            logger.error({ err }, 'Failed to create the attachment index');
          }
        }

        // emit before res.apiv3() — see rules/activity-recording.md
        const activityId: unknown = res.locals.activity?._id;
        // addActivity is best-effort; without its id there is no row to settle.
        if (typeof activityId === 'string') {
          activityEvent.emit('update', activityId, {
            action:
              SupportedAction.ACTION_ADMIN_ATTACHMENT_SEARCH_SETTINGS_UPDATE,
          });
        }
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

  // -------------------------------------------------------------------------
  // GET /failures
  // -------------------------------------------------------------------------
  router.get(
    '/failures',
    accessTokenParser([SCOPE.READ.ADMIN.FULL_TEXT_SEARCH]),
    loginRequiredStrictly,
    adminRequired,
    listFailuresValidator,
    apiV3FormValidator,
    async (req, res: ApiV3Response) => {
      try {
        const limit = Number(req.query.limit ?? 50);
        const since =
          req.query.since != null
            ? new Date(req.query.since as string)
            : undefined;

        const [items, total] = await Promise.all([
          failureLogService.listRecent({ limit, since }),
          failureLogService.totalRecent(since),
        ]);

        return res.apiv3({ items, total });
      } catch (err) {
        logger.error({ err }, 'GET /failures failed');
        return res.apiv3Err(
          new ErrorV3('Failed to retrieve extraction failure logs'),
          500,
        );
      }
    },
  );

  return router;
};
