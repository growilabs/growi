import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import nocache from 'nocache';

import loggerFactory from '~/utils/logger';

import { Config } from '../../models/config';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:healthcheck');

const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      HealthcheckInfo:
 *        description: Information of middlewares
 *        type: object
 *        properties:
 *          mongo:
 *            type: string
 *            description: 'OK'
 *            example: 'OK'
 *          searchInfo:
 *            type: object
 *            properties:
 *              cluster_name:
 *                type: string
 *                example: elasticsearch
 *              status:
 *                type: string
 *                enum: [green, yellow, red]
 *                example: yellow
 *              timed_out:
 *                type: boolean
 *                example: false
 *              number_of_nodes:
 *                type: integer
 *                example: 1
 *              number_of_data_nodes:
 *                type: integer
 *                example: 1
 *              active_primary_shards:
 *                type: integer
 *                example: 2
 *              active_shards:
 *                type: integer
 *                example: 2
 *              relocating_shards:
 *                type: integer
 *                example: 0
 *              initializing_shards:
 *                type: integer
 *                example: 0
 *              unassigned_shards:
 *                type: integer
 *                example: 1
 *              delayed_unassigned_shards:
 *                type: integer
 *                example: 0
 *              number_of_pending_tasks:
 *                type: integer
 *                example: 0
 *              number_of_in_flight_fetch:
 *                type: integer
 *                example: 0
 *              task_max_waiting_in_queue_millis:
 *                type: integer
 *                example: 0
 *              active_shards_percent_as_number:
 *                type: number
 *                format: float
 *                example: 66.66666666666666
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  async function checkMongo(errors, info) {
    try {
      await Config.findOne({});

      info.mongo = 'OK';
    } catch (err) {
      errors.push(
        new ErrorV3(
          `MongoDB is not connectable - ${err.message}`,
          'healthcheck-mongodb-unhealthy',
          err.stack,
        ),
      );
    }
  }

  async function checkSearch(errors, info) {
    const { searchService } = crowi;
    if (searchService.isConfigured) {
      try {
        info.searchInfo = await searchService.getInfoForHealth();
        searchService.resetErrorStatus();
      } catch (err) {
        errors.push(
          new ErrorV3(
            `The Search Service is not connectable - ${err.message}`,
            'healthcheck-search-unhealthy',
            err.stack,
          ),
        );
      }
    }
  }

  /**
   * @swagger
   *
   *  /healthcheck:
   *    get:
   *      tags: [Healthcheck]
   *      security: []
   *      summary: /healthcheck
   *      description: Check whether the server is healthy or not
   *      parameters:
   *        - name: checkServices
   *          in: query
   *          description: The list of services to check health
   *          schema:
   *            type: array
   *            items:
   *              type: string
   *              enum:
   *                - mongo
   *                - search
   *        - name: strictly
   *          in: query
   *          description: Check services and responds 503 if either of these is unhealthy
   *          schema:
   *            type: boolean
   *      responses:
   *        200:
   *          description: Healthy
   *          content:
   *            application/json:
   *              schema:
   *                oneOf:
   *                  - type: object
   *                    description: "Don't select checkServices"
   *                    properties:
   *                      status:
   *                        type: string
   *                  - type: object
   *                    description: "Select checkServices"
   *                    properties:
   *                      info:
   *                        $ref: '#/components/schemas/HealthcheckInfo'
   *        503:
   *          description: "errors occurs when using checkServicesStrictly"
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  errors:
   *                    type: array
   *                    description: Errors
   *                    items:
   *                      type: object
   *                      properties:
   *                        message:
   *                          type: string
   *                        code:
   *                          type: string
   *                  info:
   *                    $ref: '#/components/schemas/HealthcheckInfo'
   */
  router.get('/', nocache(), async (req, res: ApiV3Response) => {
    let checkServices = (() => {
      if (req.query.checkServices == null) return [];
      return Array.isArray(req.query.checkServices)
        ? req.query.checkServices
        : [req.query.checkServices];
    })();
    let isStrictly = req.query.strictly != null;

    // for backward compatibility
    if (req.query.connectToMiddlewares != null) {
      logger.warn(
        "The param 'connectToMiddlewares' is deprecated. Use 'checkServices[]' instead.",
      );
      checkServices = ['mongo', 'search'];
    }
    if (req.query.checkMiddlewaresStrictly != null) {
      logger.warn(
        "The param 'checkMiddlewaresStrictly' is deprecated. Use 'checkServices[]' and 'strictly' instead.",
      );
      checkServices = ['mongo', 'search'];
      isStrictly = true;
    }

    // return 200 w/o checking
    if (checkServices.length === 0) {
      res.status(200).send({ status: 'OK' });
      return;
    }

    const errors = [];
    const info = {};

    // connect to MongoDB
    if (checkServices.includes('mongo')) {
      await checkMongo(errors, info);
    }

    // connect to search service
    if (checkServices.includes('search')) {
      await checkSearch(errors, info);
    }

    if (errors.length > 0) {
      let httpStatus = 200;
      if (isStrictly) {
        httpStatus = 503;
      }

      return res.apiv3Err(errors, httpStatus, info);
    }

    res.status(200).send({ info });
  });

  return router;
};
