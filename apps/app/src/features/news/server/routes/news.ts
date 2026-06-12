import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request.js';
import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import adminRequiredFactory from '~/server/middlewares/admin-required.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import { configManager } from '~/server/service/config-manager/index.js';
import loggerFactory from '~/utils/logger/index.js';

import { NewsService } from '../services/news-service.js';

const logger = loggerFactory('growi:feature:news:routes');

/**
 * Maximum number of news items returnable per request.
 * Caps caller-supplied `limit` so a misuse cannot make a single request
 * pull an unbounded result set into memory.
 */
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 10;

type NewsRequest = CrowiRequest & { user: IUserHasId };

/**
 * Returns user roles based on admin flag
 */
const getUserRoles = (user: IUserHasId): string[] => {
  return user.admin ? ['admin'] : ['general'];
};

/**
 * Resolve the effective list limit from a query value.
 * Falls back to `DEFAULT_LIST_LIMIT` for missing/invalid input,
 * and silently caps the result to `[1, MAX_LIST_LIMIT]`.
 */
const resolveLimit = (raw: unknown): number => {
  const requested =
    raw != null
      ? parseInt(String(raw), 10) || DEFAULT_LIST_LIMIT
      : DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(requested, 1), MAX_LIST_LIMIT);
};

/**
 * Creates and returns the news Express router.
 * Accepts an optional Crowi instance for middleware setup.
 */
export const createNewsRouter = (crowi?: Crowi): express.Router => {
  const router = express.Router();

  // Use loginRequiredFactory when crowi is provided, otherwise use a pass-through middleware for testing
  const loginRequiredStrictly =
    crowi != null
      ? loginRequiredFactory(crowi)
      : (_req: unknown, _res: unknown, next: () => void) => next();
  const adminRequired =
    crowi != null
      ? adminRequiredFactory(crowi)
      : (_req: unknown, _res: unknown, next: () => void) => next();

  /**
   * GET /news/list
   * Returns paginated news items filtered by user role
   */
  router.get(
    '/list',
    accessTokenParser([SCOPE.READ.FEATURES.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: NewsRequest, res) => {
      try {
        const user = req.user;
        const userRoles = getUserRoles(user);

        const limit = resolveLimit(req.query.limit);
        const offset =
          req.query.offset != null
            ? parseInt(String(req.query.offset), 10) || 0
            : 0;
        const onlyUnread = req.query.onlyUnread === 'true';

        const service = new NewsService();
        const result = await service.listForUser(user._id, userRoles, {
          limit,
          offset,
          onlyUnread,
        });

        return res.json(result);
      } catch (err) {
        logger.error('GET /news/list failed', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /news/unread-count
   * Returns the unread news count for the current user
   */
  router.get(
    '/unread-count',
    accessTokenParser([SCOPE.READ.FEATURES.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: NewsRequest, res) => {
      try {
        const user = req.user;
        const userRoles = getUserRoles(user);

        const service = new NewsService();
        const count = await service.getUnreadCount(user._id, userRoles);

        return res.json({ count });
      } catch (err) {
        logger.error('GET /news/unread-count failed', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /news/mark-read
   * Marks a single news item as read for the current user
   */
  router.post(
    '/mark-read',
    accessTokenParser([SCOPE.WRITE.FEATURES.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: NewsRequest, res) => {
      try {
        const { newsItemId } = req.body;

        if (!newsItemId || !mongoose.isValidObjectId(newsItemId)) {
          return res
            .status(400)
            .json({ error: 'Invalid or missing newsItemId' });
        }

        const user = req.user;
        const service = new NewsService();
        await service.markRead(
          user._id,
          new mongoose.Types.ObjectId(newsItemId),
        );

        return res.json({ ok: true });
      } catch (err) {
        logger.error('POST /news/mark-read failed', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /news/mark-all-read
   * Marks all news items as read for the current user
   */
  router.post(
    '/mark-all-read',
    accessTokenParser([SCOPE.WRITE.FEATURES.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: NewsRequest, res) => {
      try {
        const user = req.user;
        const userRoles = getUserRoles(user);

        const service = new NewsService();
        await service.markAllRead(user._id, userRoles);

        return res.json({ ok: true });
      } catch (err) {
        logger.error('POST /news/mark-all-read failed', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /news/admin/delivery-setting
   * Returns the current value of `news:isDeliveryEnabled` (admin only)
   */
  router.get(
    '/admin/delivery-setting',
    accessTokenParser([SCOPE.READ.ADMIN.APP]),
    loginRequiredStrictly,
    adminRequired,
    (_req, res) => {
      try {
        const isDeliveryEnabled = configManager.getConfig(
          'news:isDeliveryEnabled',
        );
        return res.json({ isDeliveryEnabled });
      } catch (err) {
        logger.error('GET /news/admin/delivery-setting failed', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /news/admin/delivery-setting
   * Updates `news:isDeliveryEnabled` (admin only). Body: `{ flag: boolean }`.
   * The new value is persisted to the `Config` collection and reflected on
   * the next cron tick without a restart.
   */
  router.post(
    '/admin/delivery-setting',
    accessTokenParser([SCOPE.WRITE.ADMIN.APP]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      try {
        const { flag } = req.body;
        if (typeof flag !== 'boolean') {
          return res.status(400).json({ error: '`flag` must be a boolean' });
        }

        await configManager.updateConfigs({ 'news:isDeliveryEnabled': flag });
        return res.json({ isDeliveryEnabled: flag });
      } catch (err) {
        logger.error('POST /news/admin/delivery-setting failed', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  return router;
};

/**
 * Default export for Express app registration (crowi factory pattern).
 * Required by the apiv3 router loader which calls require(...).default(crowi).
 */
// biome-ignore lint/style/noDefaultExport: required by apiv3 router loader
export default (crowi: Crowi): express.Router => createNewsRouter(crowi);
