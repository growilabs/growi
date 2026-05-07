import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';

/**
 * Returns true when the attachment full-text search feature is fully configured.
 * Mirrors the logic in require-search-attachments-enabled.ts.
 *
 * @param {import('~/server/crowi').default} crowi Crowi instance
 * @returns {boolean}
 */
function isAttachmentSearchEnabled(crowi) {
  const extractorUri = configManager.getConfig(
    'app:attachmentFullTextSearch:extractorUri',
  );
  const extractorToken = configManager.getConfig(
    'app:attachmentFullTextSearch:extractorToken',
  );
  return (
    crowi.searchService?.isConfigured === true &&
    extractorUri != null &&
    extractorUri !== '' &&
    extractorToken != null &&
    extractorToken !== ''
  );
}

const logger = loggerFactory('growi:routes:apiv3:search');

const express = require('express');
const { body } = require('express-validator');
const noCache = require('nocache');

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     Indices:
 *       type: object
 *       properties:
 *         growi:
 *           type: object
 *           properties:
 *             uuid:
 *               type: string
 *             health:
 *               type: string
 *             status:
 *               type: string
 *             primaries:
 *               type: object
 *               $ref: '#/components/schemas/SearchIndex'
 *             total:
 *               type: object
 *               $ref: '#/components/schemas/SearchIndex'
 *         aliases:
 *           type: object
 *           properties:
 *             growi:
 *               type: object
 *               properties:
 *                 aliases:
 *                   type: object
 *                   properties:
 *                     growi-alias:
 *                       type: object
 *         isNormalized:
 *           type: boolean
 *     SearchIndex:
 *       type: object
 *       properties:
 *         docs:
 *           type: object
 *           properties:
 *             count:
 *               type: integer
 *             deleted:
 *               type: integer
 *         store:
 *           type: object
 *           properties:
 *             size_in_bytes:
 *               type: integer
 *             total_data_set_size_in_bytes:
 *               type: integer
 *             reserved_in_bytes:
 *               type: integer
 *         indexing:
 *           type: object
 *           properties:
 *             index_total:
 *               type: integer
 *             index_time_in_millis:
 *               type: integer
 *             index_current:
 *               type: integer
 *             index_failed:
 *               type: integer
 *             delete_total:
 *               type: integer
 *             delete_time_in_millis:
 *               type: integer
 *             delete_current:
 *               type: integer
 *             noop_update_total:
 *               type: integer
 *             is_throttled:
 *               type: boolean
 *             throttle_time_in_millis:
 *               type: integer
 *             write_load:
 *               type: number
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const router = express.Router();

  const loginRequired = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.events.activity;

  /**
   * @swagger
   *
   *  /search/indices:
   *    get:
   *      tags: [FullTextSearch Management]
   *      summary: /search/indices
   *      description: Get current status of indices
   *      responses:
   *        200:
   *          description: Status of indices
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  info:
   *                    type: object
   *                    description: Status of indices
   *                    $ref: '#/components/schemas/Indices'
   */
  router.get(
    '/indices',
    noCache(),
    accessTokenParser([SCOPE.READ.ADMIN.FULL_TEXT_SEARCH], {
      acceptLegacy: true,
    }),
    loginRequired,
    adminRequired,
    async (_req, res) => {
      const { searchService } = crowi;

      if (!searchService.isConfigured) {
        return res.apiv3Err(
          new ErrorV3(
            'SearchService is not configured',
            'search-service-unconfigured',
          ),
          503,
        );
      }

      try {
        const info = await searchService.getInfoForAdmin();
        return res.status(200).send({ info });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 503);
      }
    },
  );

  /**
   * @swagger
   *
   *  /search/connection:
   *    post:
   *      tags: [FullTextSearch Management]
   *      summary: /search/connection
   *      description: Reconnect to Elasticsearch
   *      responses:
   *        200:
   *          description: Successfully connected
   */
  router.post(
    '/connection',
    accessTokenParser([SCOPE.WRITE.ADMIN.FULL_TEXT_SEARCH], {
      acceptLegacy: true,
    }),
    loginRequired,
    adminRequired,
    addActivity,
    async (_req, res) => {
      const { searchService } = crowi;

      if (!searchService.isConfigured) {
        return res.apiv3Err(
          new ErrorV3(
            'SearchService is not configured',
            'search-service-unconfigured',
          ),
        );
      }

      try {
        await searchService.reconnectClient();

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_ADMIN_SEARCH_CONNECTION,
        });

        return res.status(200).send();
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 503);
      }
    },
  );

  const validatorForPutIndices = [
    body('operation').isString().isIn(['rebuild', 'normalize']),
    body('includeAttachments').optional().isBoolean(),
  ];

  /**
   * @swagger
   *
   *  /search/indices:
   *    put:
   *      tags: [FullTextSearch Management]
   *      summary: /search/indices
   *      description: Operate indices
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              properties:
   *                operation:
   *                  type: string
   *                  description: Operation type against to indices >
   *                    * `normalize` - Normalize indices
   *                    * `rebuild` - Rebuild indices
   *                  enum: [normalize, rebuild]
   *      responses:
   *        200:
   *          description: Return 200
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  message:
   *                    type: string
   *                    description: Operation is successfully processed, or requested
   */
  router.put(
    '/indices',
    accessTokenParser([SCOPE.WRITE.ADMIN.FULL_TEXT_SEARCH], {
      acceptLegacy: true,
    }),
    loginRequired,
    adminRequired,
    addActivity,
    validatorForPutIndices,
    apiV3FormValidator,
    async (req, res) => {
      const operation = req.body.operation;
      const includeAttachments = req.body.includeAttachments === true;

      const { searchService } = crowi;

      if (!searchService.isConfigured) {
        return res.apiv3Err(
          new ErrorV3(
            'SearchService is not configured',
            'search-service-unconfigured',
          ),
        );
      }
      if (!searchService.isReachable) {
        return res.apiv3Err(
          new ErrorV3(
            'SearchService is not reachable',
            'search-service-unreachable',
          ),
        );
      }

      try {
        switch (operation) {
          case 'normalize':
            // wait the processing is terminated
            await searchService.normalizeIndices();

            activityEvent.emit('update', res.locals.activity._id, {
              action: SupportedAction.ACTION_ADMIN_SEARCH_INDICES_NORMALIZE,
            });

            return res
              .status(200)
              .send({ message: 'Operation is successfully processed.' });
          case 'rebuild':
            if (includeAttachments) {
              // Guard: attachment search feature must be enabled
              if (!isAttachmentSearchEnabled(crowi)) {
                return res.apiv3Err(
                  new ErrorV3(
                    'Attachment full-text search feature is disabled',
                    'feature_disabled',
                  ),
                  503,
                );
              }

              // Guard: batch service must be registered (done in task 9.1)
              const batch = crowi.attachmentReindexBatch;
              if (batch == null) {
                return res.apiv3Err(
                  new ErrorV3(
                    'Attachment reindex batch service is not available',
                    'feature_disabled',
                  ),
                  503,
                );
              }

              const tmpIndexName = 'attachments-tmp';
              try {
                batch.begin(tmpIndexName);
                // Rebuild page/comment index (awaited so we sequence attachments after)
                await searchService.rebuildIndex();

                await batch.addAllAttachments(
                  tmpIndexName,
                  (processed, total) => {
                    logger.debug(
                      `Attachment reindex progress: ${processed}/${total}`,
                    );
                  },
                );
              } finally {
                batch.end();
              }

              activityEvent.emit('update', res.locals.activity._id, {
                action: SupportedAction.ACTION_ADMIN_SEARCH_INDICES_REBUILD,
              });

              return res
                .status(200)
                .send({ message: 'Operation is successfully processed.' });
            }

            // includeAttachments=false: existing fire-and-forget page rebuild
            // NOT wait the processing is terminated
            searchService.rebuildIndex();

            activityEvent.emit('update', res.locals.activity._id, {
              action: SupportedAction.ACTION_ADMIN_SEARCH_INDICES_REBUILD,
            });

            return res
              .status(200)
              .send({ message: 'Operation is successfully requested.' });
          default:
            throw new Error(`Unimplemented operation: ${operation}`);
        }
      } catch (err) {
        return res.apiv3Err(err, 503);
      }
    },
  );

  return router;
};
