import { SupportedAction } from '~/interfaces/activity';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:logout'); // eslint-disable-line no-unused-vars

const express = require('express');

const router = express.Router();

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const activityEvent = crowi.event('activity');
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
