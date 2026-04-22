import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import { NewsService } from '../services/news-service';

const logger = loggerFactory('growi:feature:news:routes');

type NewsRequest = CrowiRequest & { user: IUserHasId };

/**
 * Returns user roles based on admin flag
 */
const getUserRoles = (user: IUserHasId): string[] => {
  return user.admin ? ['admin'] : ['general'];
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

  /**
   * GET /news/list
   * Returns paginated news items filtered by user role
   */
  router.get(
    '/list',
    accessTokenParser([SCOPE.READ.USER_SETTINGS.IN_APP_NOTIFICATION], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    async (req: NewsRequest, res) => {
      try {
        const user = req.user;
        const userRoles = getUserRoles(user);

        const limit =
          req.query.limit != null
            ? parseInt(String(req.query.limit), 10) || 10
            : 10;
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
    accessTokenParser([SCOPE.READ.USER_SETTINGS.IN_APP_NOTIFICATION], {
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
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.IN_APP_NOTIFICATION], {
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
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.IN_APP_NOTIFICATION], {
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

  return router;
};

/**
 * Default export for Express app registration (crowi factory pattern).
 * Required by the apiv3 router loader which calls require(...).default(crowi).
 */
// biome-ignore lint/style/noDefaultExport: required by apiv3 router loader
export default (crowi: Crowi): express.Router => createNewsRouter(crowi);
