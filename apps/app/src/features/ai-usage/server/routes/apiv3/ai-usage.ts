import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';
import nocache from 'nocache';

import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { AI_USAGE_RETENTION_DAYS } from '../../../interfaces/ai-usage-retention';
import { buildAiUsageReport } from '../../services/build-ai-usage-report';

const logger = loggerFactory('growi:features:ai-usage:routes:apiv3');

const CANONICAL_PATH = '/_api/v3/ai-usage';
const ALLOWED_METHOD = 'GET';

const MIN_SINCE_COUNT = 1;
const MAX_SINCE_COUNT = 10;
const DAY_MS = 86_400_000;

// ISO 8601 date-time with a mandatory timezone designator (Z or ±HH:MM).
const ISO_DATE_TIME_WITH_TZ =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const toArray = (raw: unknown): unknown[] =>
  Array.isArray(raw) ? raw : raw == null ? [] : [raw];

// V8's Date rolls over an impossible day (2026-09-31 → 10-01) and accepts
// hour 24 (as the next day's 00:00) instead of returning NaN; every other
// out-of-range field already yields NaN.
const parseIsoDateTimeWithTz = (value: unknown): Date | null => {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_TIME_WITH_TZ.exec(value);
  if (match == null) return null;

  const [year, month, day, hour] = match.slice(1, 5).map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth || hour > 23) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const assertValidSinces = (raw: unknown): true => {
  const values = toArray(raw);
  if (values.length < MIN_SINCE_COUNT || values.length > MAX_SINCE_COUNT) {
    throw new Error(
      `must be given ${MIN_SINCE_COUNT} to ${MAX_SINCE_COUNT} times`,
    );
  }

  const now = Date.now();
  for (const value of values) {
    const date = parseIsoDateTimeWithTz(value);
    if (date == null) {
      throw new Error('must be an ISO 8601 date-time with a timezone');
    }
    if (date.getTime() > now) {
      throw new Error('must not be in the future');
    }
    if (date.getTime() < now - AI_USAGE_RETENTION_DAYS * DAY_MS) {
      throw new Error(
        `must not be more than ${AI_USAGE_RETENTION_DAYS} days ago`,
      );
    }
  }
  return true;
};

// Express routes case/slash variants and every method here, while the rate
// limiter keys on the literal req.path and method; only the canonical GET may
// proceed (see design.md AiUsageRoute).
const entryGuard = (
  req: Request,
  res: ApiV3Response,
  next: NextFunction,
): void => {
  const [pathname] = req.originalUrl.split('?');
  if (pathname !== CANONICAL_PATH) {
    res.apiv3Err(new ErrorV3('Not Found', 'not_found'), 404);
    return;
  }
  if (req.method !== ALLOWED_METHOD) {
    res.set('Allow', ALLOWED_METHOD);
    res.apiv3Err(new ErrorV3('Method Not Allowed', 'method_not_allowed'), 405);
    return;
  }
  next();
};

const validator = [query('since').custom(assertValidSinces)];

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      AiUsageReport:
 *        type: object
 *        required:
 *          - windows
 *          - catalog
 *        properties:
 *          growiAppIdForCloud:
 *            type: integer
 *            description: Present only when the GROWI.cloud app ID is configured
 *          windows:
 *            type: array
 *            description: Totals per requested start time, in request order
 *            items:
 *              type: object
 *              required:
 *                - since
 *                - weightedUnits
 *                - unweightedTokens
 *              properties:
 *                since:
 *                  type: string
 *                  format: date-time
 *                  description: The requested start time, echoed back in UTC
 *                weightedUnits:
 *                  type: number
 *                  description: Sum of usage weighted against the base model
 *                unweightedTokens:
 *                  type: integer
 *                  description: Input + output tokens of records whose weighted usage is unknown
 *          catalog:
 *            type: object
 *            required:
 *              - source
 *              - contentFetchedAt
 *            properties:
 *              source:
 *                type: string
 *                enum: [bundled, refreshed]
 *              contentFetchedAt:
 *                type: string
 *                format: date-time
 *                description: When the effective model catalog's content was fetched
 */
export const setup = (): Router => {
  const router = express.Router();

  /**
   * @swagger
   *
   *  /ai-usage:
   *    get:
   *      tags: [AiUsage]
   *      security: []
   *      summary: /ai-usage
   *      description: >-
   *        Get the GROWI-wide AI usage totals since each given start time, and
   *        the freshness of the model catalog used for weighting. Only the exact
   *        path accepts requests; any other spelling returns 404.
   *      parameters:
   *        - name: since
   *          in: query
   *          required: true
   *          description: >-
   *            Start times (1 to 10) as ISO 8601 date-times with a timezone,
   *            not in the future and not more than 90 days ago. Repeat the
   *            parameter for multiple values; encode '+' as %2B.
   *          style: form
   *          explode: true
   *          schema:
   *            type: array
   *            minItems: 1
   *            maxItems: 10
   *            items:
   *              type: string
   *              format: date-time
   *      responses:
   *        200:
   *          description: Usage totals
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/AiUsageReport'
   *        400:
   *          description: Invalid since values
   *        404:
   *          description: The path is not spelled exactly /_api/v3/ai-usage
   *        405:
   *          description: Methods other than GET (the Allow header lists GET)
   *        429:
   *          description: Too many requests
   */
  router.use(nocache(), entryGuard);
  router.get(
    '/',
    ...validator,
    apiV3FormValidator,
    async (req: Request, res: ApiV3Response) => {
      const sinces = toArray(req.query.since).map(
        (value) => new Date(String(value)),
      );
      try {
        const report = await buildAiUsageReport(sinces);
        return res.apiv3(report);
      } catch (err) {
        logger.error({ err }, 'Failed to build the AI usage report');
        return res.apiv3Err(
          new ErrorV3('Failed to build the AI usage report', 'ai_usage_failed'),
          500,
        );
      }
    },
  );

  return router;
};
