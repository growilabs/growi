import { SCOPE, type Scope } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import express, {
  type Request,
  type RequestHandler,
  type Router,
} from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { parseBackfillStartRequest } from '../services/backfill-scope-request';
import { readBacklinksBackfillState } from '../services/read-backfill-admin-state';

const logger = loggerFactory('growi:features:backlinks:routes:backfill-admin');

const internalError = (res: ApiV3Response, err: unknown, action: string) => {
  logger.error({ err }, `Failed to ${action} the backlinks backfill`);
  // Not forwarding `err`: apiv3Err would serialize the driver's message to the client.
  return res.apiv3Err(
    new ErrorV3(
      `Failed to ${action} the backlinks backfill`,
      'backfill_request_failed',
    ),
    500,
  );
};

const conflict = (res: ApiV3Response, message: string, code: string) =>
  res.apiv3Err(new ErrorV3(message, code), 409);

/**
 * @swagger
 * components:
 *   schemas:
 *     BacklinksBackfillState:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [idle, requested, running, stopped, complete, failed]
 *         stopRequested:
 *           type: boolean
 *         processed:
 *           type: integer
 *         runTotal:
 *           type: integer
 *           nullable: true
 *           description: Pages in the run's range, counted at its first claim
 *         skippedPages:
 *           type: integer
 *         coverage:
 *           type: string
 *           enum: [none, partial, all]
 *         coveredSince:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         completedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         lastError:
 *           type: string
 *           nullable: true
 *         failedAttempts:
 *           type: integer
 *           description: Failures in a row with no progress between them
 *         retryAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: >
 *             When a failed run is retried on its own; null when no retry is due
 *         notIncludedCount:
 *           type: integer
 *           description: Pages the coverage does not include yet
 *         totalPageCount:
 *           type: integer
 */

/**
 * @swagger
 *
 *    /backlinks-backfill:
 *      get:
 *        tags: [BacklinksBackfill]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: Get the state of the backlinks backfill
 *        description: >
 *          Admin only. Requires the `read:admin:app` scope. `notIncludedCount` and
 *          `totalPageCount` are counted on every read over the pages the backfill scans
 *          (neither trashed nor empty), so they are approximate.
 *        responses:
 *          200:
 *            description: The job state
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    state:
 *                      $ref: '#/components/schemas/BacklinksBackfillState'
 *          302:
 *            description: The caller is logged in but not an admin (redirected to /)
 *          403:
 *            description: Not authenticated or insufficient scope
 */

/**
 * @swagger
 *
 *    /backlinks-backfill/start:
 *      post:
 *        tags: [BacklinksBackfill]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: Request a new backlinks backfill run over a scope
 *        description: >
 *          Admin only. Requires the `write:admin:app` scope. Writes the request, clears the
 *          previous run's progress, and claims it in this process at once; the run continues
 *          after the response. Refused while a run is active (requested, running, or failed
 *          with a retry due), and once every page is covered.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                oneOf:
 *                  - type: object
 *                    additionalProperties: false
 *                    required: [kind]
 *                    properties:
 *                      kind:
 *                        type: string
 *                        enum: [all]
 *                  - type: object
 *                    additionalProperties: false
 *                    required: [kind, maxPages]
 *                    properties:
 *                      kind:
 *                        type: string
 *                        enum: [maxPages]
 *                      maxPages:
 *                        type: integer
 *                        minimum: 1
 *                        maximum: 2147483647
 *                        description: The newest N pages of the wiki
 *                  - type: object
 *                    additionalProperties: false
 *                    required: [kind, since]
 *                    properties:
 *                      kind:
 *                        type: string
 *                        enum: [since]
 *                      since:
 *                        type: string
 *                        format: date-time
 *                        description: Pages edited at or after this time; not in the future
 *        responses:
 *          200:
 *            description: The job state after the request
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    state:
 *                      $ref: '#/components/schemas/BacklinksBackfillState'
 *          400:
 *            description: Invalid scope
 *          409:
 *            description: >
 *              A run is already requested, running or waiting to retry (code
 *              backfill_run_active), or every page is already covered (code
 *              backfill_already_complete)
 *          302:
 *            description: The caller is logged in but not an admin (redirected to /)
 *          403:
 *            description: Not authenticated or insufficient scope
 */

/**
 * @swagger
 *
 *    /backlinks-backfill/stop:
 *      post:
 *        tags: [BacklinksBackfill]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: Stop the backlinks backfill
 *        description: >
 *          Admin only. Requires the `write:admin:app` scope. Cancels a request not yet
 *          claimed, asks a running run to stop at its next checkpoint (`stopRequested`), or
 *          ends directly as `stopped` a run whose owner's lease has expired or a failed run
 *          waiting to retry.
 *        responses:
 *          200:
 *            description: The job state after the stop
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    state:
 *                      $ref: '#/components/schemas/BacklinksBackfillState'
 *          409:
 *            description: >
 *              No run is requested, running or waiting to retry (code backfill_not_stoppable)
 *          302:
 *            description: The caller is logged in but not an admin (redirected to /)
 *          403:
 *            description: Not authenticated or insufficient scope
 */

/**
 * @swagger
 *
 *    /backlinks-backfill/resume:
 *      post:
 *        tags: [BacklinksBackfill]
 *        security:
 *          - bearer: []
 *          - accessTokenInQuery: []
 *          - accessTokenHeaderAuth: []
 *        summary: Resume a stopped or failed backlinks backfill run
 *        description: >
 *          Admin only. Requires the `write:admin:app` scope. Requests the run again, keeping
 *          its scope, range and progress, and claims it in this process at once, so it
 *          continues where it stopped. A failed run gets its retries again.
 *        responses:
 *          200:
 *            description: The job state after the request
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    state:
 *                      $ref: '#/components/schemas/BacklinksBackfillState'
 *          409:
 *            description: The run is neither stopped nor failed (code backfill_not_resumable)
 *          302:
 *            description: The caller is logged in but not an admin (redirected to /)
 *          403:
 *            description: Not authenticated or insufficient scope
 */
export const createBacklinksBackfillAdminRouter = (crowi: Crowi): Router => {
  const router = express.Router();
  const jobs = prisma.pagelinkbackfilljobs;
  const adminOnly = (scope: Scope): RequestHandler[] => [
    accessTokenParser([scope], { acceptLegacy: true }),
    loginRequiredFactory(crowi),
    adminRequiredFactory(crowi),
  ];

  const respondWithState = async (res: ApiV3Response) =>
    res.apiv3({ state: await readBacklinksBackfillState() });

  // Not awaited: the run continues after the response. It logs its own failures and never rejects.
  const claimNow = (): void => {
    void crowi.pageLinkService.claimBackfillNow();
  };

  router.get(
    '/',
    adminOnly(SCOPE.READ.ADMIN.APP),
    async (_req: Request, res: ApiV3Response) => {
      try {
        return await respondWithState(res);
      } catch (err) {
        return internalError(res, err, 'read');
      }
    },
  );

  router.post(
    '/start',
    adminOnly(SCOPE.WRITE.ADMIN.APP),
    async (req: Request, res: ApiV3Response) => {
      const parsed = parseBackfillStartRequest(req.body, new Date());
      if (!parsed.ok) {
        return res.apiv3Err(new ErrorV3(parsed.reason, 'invalid_scope'), 400);
      }
      try {
        await jobs.ensureExists();
        if (!(await jobs.requestStart(parsed.scope))) {
          // Read after the refusal only to name its reason; the write's filter was the check.
          const job = await jobs.findFirst({});
          return job?.coverage === 'all'
            ? conflict(
                res,
                'Backlinks are already indexed for all pages',
                'backfill_already_complete',
              )
            : conflict(
                res,
                'A backlinks backfill run is already requested, running or waiting to retry',
                'backfill_run_active',
              );
        }
        claimNow();
        return await respondWithState(res);
      } catch (err) {
        return internalError(res, err, 'start');
      }
    },
  );

  router.post(
    '/stop',
    adminOnly(SCOPE.WRITE.ADMIN.APP),
    async (_req: Request, res: ApiV3Response) => {
      try {
        await jobs.ensureExists();
        if (!(await jobs.requestStop())) {
          return conflict(
            res,
            'No backlinks backfill run is requested, running or waiting to retry',
            'backfill_not_stoppable',
          );
        }
        return await respondWithState(res);
      } catch (err) {
        return internalError(res, err, 'stop');
      }
    },
  );

  router.post(
    '/resume',
    adminOnly(SCOPE.WRITE.ADMIN.APP),
    async (_req: Request, res: ApiV3Response) => {
      try {
        await jobs.ensureExists();
        if (!(await jobs.requestResume())) {
          return conflict(
            res,
            'Only a stopped or failed backlinks backfill run can be resumed',
            'backfill_not_resumable',
          );
        }
        claimNow();
        return await respondWithState(res);
      } catch (err) {
        return internalError(res, err, 'resume');
      }
    },
  );

  return router;
};
