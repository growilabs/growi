import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';

const _logger = loggerFactory('growi:routes:apiv3:logout');

import express from 'express';

const router = express.Router();

/**
 * @param {import('~/server/crowi').default} crowi Crowi instance
 * @returns {import('express').Router} router
 */
export const setup = (crowi) => {
  const activityEvent = crowi.events.activity;
  const addActivity = generateAddActivityMiddleware(crowi);

  /**
   * @swagger
   *  /logout:
   *    post:
   *      tags: [Users]
   *      security:
   *        - cookieAuth: []
   *      summary: Logout user
   *      description: Logout the currently authenticated user
   *      responses:
   *        200:
   *          description: Successfully logged out
   *        500:
   *          description: Internal server error
   */
  router.post('/', addActivity, async (req, res) => {
    req.session.destroy();

    const activityId = res.locals.activity._id;
    const parameters = { action: SupportedAction.ACTION_USER_LOGOUT };
    activityEvent.emit('update', activityId, parameters);

    return res.send();
  });

  return router;
};
