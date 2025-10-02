import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import { SupportedAction } from '~/interfaces/activity';
import { SCOPE } from '@growi/core/dist/interfaces';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { GlobalNotificationSettingType } from '~/server/models/GlobalNotificationSetting';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';
import { removeNullPropertyFromObject } from '~/utils/object-utils';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import UpdatePost from '../../models/update-post';


// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:routes:apiv3:notification-setting');


const router = express.Router();

const { body } = require('express-validator');

const validator = {
  userNotification: [
    body('pathPattern').isString().trim(),
    body('channel').isString().trim(),
  ],
  globalNotification: [
    body('triggerPath').isString().trim().not()
      .isEmpty(),
    body('notifyType').isString().trim().isIn(['mail', 'slack']),
    body('toEmail').trim().custom((value, { req }) => {
      return (req.body.notifyType === 'mail') ? (!!value && value.match(/.+@.+\..+/)) : true;
    }),
    body('slackChannels').trim().custom((value, { req }) => {
      return (req.body.notifyType === 'slack') ? !!value : true;
    }),
  ],
  notifyForPageGrant: [
    body('isNotificationForOwnerPageEnabled').if(value => value != null).isBoolean(),
    body('isNotificationForGroupPageEnabled').if(value => value != null).isBoolean(),
  ],
};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      NotificationParams:
 *        type: object
 *        properties:
 *          isSlackbotConfigured:
 *            type: boolean
 *            description: status of slack integration
 *          isSlackLegacyConfigured:
 *            type: boolean
 *            description: status of slack legacy integration
 *          currentBotType:
 *            type: string
 *            description: current bot type
 *          userNotifications:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/UserNotification'
 *          isNotificationForOwnerPageEnabled:
 *            type: boolean
 *            description: Whether to notify on owner page
 *          isNotificationForGroupPageEnabled:
 *            type: boolean
 *            description: Whether to notify on group page
 *          globalNotifications:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/GlobalNotificationParams'
 *            description: global notifications
 *      UserNotification:
 *        type: object
 *        properties:
 *          channel:
 *            type: string
 *            description: slack channel name without '#'
 *          pathPattern:
 *            type: string
 *            description: path name of wiki
 *          createdAt:
 *            type: string
 *            description: created date
 *          creator:
 *            $ref: '#/components/schemas/User'
 *            description: user who set notification
 *          patternPrefix:
 *            type: string
 *            description: path pattern prefix
 *          patternPrefix2:
 *            type: string
 *            description: path pattern prefix2
 *          provider:
 *            type: string
 *            description: provider
 *          updatedAt:
 *            type: string
 *            description: updated date
 *          __v:
 *            type: number
 *            description: version
 *          _id:
 *            type: string
 *            description: id
 *      UserNotificationParams:
 *        type: object
 *        properties:
 *          pathPattern:
 *            type: string
 *            description: path name of wiki
 *          channel:
 *            type: string
 *            description: slack channel name without '#'
 *      NotifyForPageGrant:
 *        type: object
 *        properties:
 *          isNotificationForOwnerPageEnabled:
 *            type: boolean
 *            description: Whether to notify on owner page
 *          isNotificationForGroupPageEnabled:
 *            type: boolean
 *            description: Whether to notify on group page
 *      GlobalNotification:
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: id
 *          isEnabled:
 *            type: boolean
 *            description: is notification enabled
 *          triggerEvents:
 *            type: array
 *            items:
 *              type: string
 *            description: trigger events for notify
 *          __t:
 *            type: string
 *            description: type of notification
 *          slackChannels:
 *            type: string
 *            description: channels for notify
 *          triggerPath:
 *            type: string
 *            description: trigger path for notify
 *          __v:
 *            type: number
 *            description: version
 *      GlobalNotificationParams:
 *        type: object
 *        properties:
 *          notifyType:
 *            type: string
 *            description: What is type for notify
 *          toEmail:
 *            type: string
 *            description: email for notify
 *          slackChannels:
 *            type: string
 *            description: channels for notify
 *          triggerPath:
 *            type: string
 *            description: trigger path for notify
 *          triggerEvents:
 *            type: array
 *            items:
 *              type: string
 *            description: trigger events for notify
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const Strictly = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  const GlobalNotificationSetting = crowi.model('GlobalNotificationSetting');

  const GlobalNotificationMailSetting = crowi.models.GlobalNotificationMailSetting;
  const GlobalNotificationSlackSetting = crowi.models.GlobalNotificationSlackSetting;

  /**
   * @swagger
   *
   *    /notification-setting/:
   *      get:
   *        tags: [NotificationSetting]
   *        security:
   *          - cookieAuth: []
   *        description: Get notification paramators
   *        responses:
   *          200:
   *            description: params of notification
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    notificationParams:
   *                      type: object
   *                      description: notification params
   *                      $ref: '#/components/schemas/NotificationParams'
   */
  router.get('/', accessTokenParser([SCOPE.READ.ADMIN.EXTERNAL_NOTIFICATION]), Strictly, adminRequired, async(req, res) => {

    const notificationParams = {
      // status of slack intagration
      isSlackbotConfigured: crowi.slackIntegrationService.isSlackbotConfigured,
      isSlackLegacyConfigured: crowi.slackIntegrationService.isSlackLegacyConfigured,
      currentBotType: await crowi.configManager.getConfig('slackbot:currentBotType'),

      userNotifications: await UpdatePost.findAll(),
      isNotificationForOwnerPageEnabled: await crowi.configManager.getConfig('notification:owner-page:isEnabled'),
      isNotificationForGroupPageEnabled: await crowi.configManager.getConfig('notification:group-page:isEnabled'),
      globalNotifications: await GlobalNotificationSetting.findAll(),
    };
    return res.apiv3({ notificationParams });
  });

  /**
  * @swagger
  *
  *    /notification-setting/user-notification:
  *      post:
  *        tags: [NotificationSetting]
  *        security:
  *         - cookieAuth: []
  *        description: add user notification setting
  *        requestBody:
  *          required: true
  *          content:
  *            application/json:
  *              schema:
  *                $ref: '#/components/schemas/UserNotificationParams'
  *        responses:
  *          200:
  *            description: Succeeded to add user notification setting
  *            content:
  *              application/json:
  *                schema:
  *                  properties:
  *                    responseParams:
  *                      type: object
  *                      description: response params
  *                      properties:
  *                        createdUser:
  *                          $ref: '#/components/schemas/User'
  *                          description: user who set notification
  *                        userNotifications:
  *                          type: array
  *                          items:
  *                            $ref: '#/components/schemas/UserNotification'
  *                            description: user notification settings
  */
  // eslint-disable-next-line max-len
  router.post('/user-notification', accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]), Strictly, adminRequired, addActivity, validator.userNotification, apiV3FormValidator, async(req, res) => {
    const { pathPattern, channel } = req.body;

    try {
      logger.info('notification.add', pathPattern, channel);
      const responseParams = {
        createdUser: await UpdatePost.createUpdatePost(pathPattern, channel, req.user),
        userNotifications: await UpdatePost.findAll(),
      };

      const parameters = { action: SupportedAction.ACTION_ADMIN_USER_NOTIFICATION_SETTINGS_ADD };
      activityEvent.emit('update', res.locals.activity._id, parameters);

      return res.apiv3({ responseParams }, 201);
    }
    catch (err) {
      const msg = 'Error occurred in updating user notification';
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(msg, 'update-userNotification-failed'));
    }

  });

  /**
   * @swagger
   *
   *    /notification-setting/user-notification/{id}:
   *      delete:
   *        tags: [NotificationSetting]
   *        security:
   *          - cookieAuth: []
   *        description: delete user trigger notification pattern
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of user trigger notification
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to delete user trigger notification pattern
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/UserNotification'
   */
  router.delete('/user-notification/:id',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    addActivity,
    async(req, res) => {
      const { id } = req.params;

      try {
        const deletedNotificaton = await UpdatePost.findOneAndRemove({ _id: id });

        const parameters = { action: SupportedAction.ACTION_ADMIN_USER_NOTIFICATION_SETTINGS_DELETE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(deletedNotificaton);
      }
      catch (err) {
        const msg = 'Error occurred in delete user trigger notification';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'delete-userTriggerNotification-failed'));
      }
    });


  /**
   * @swagger
   *
   *    /notification-setting/global-notification/{id}:
   *      get:
   *        tags: [NotificationSetting]
   *        security:
   *          - cookieAuth: []
   *        description: get global notification setting
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of global notification
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to get global notification setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    globalNotification:
   *                      $ref: '#/components/schemas/GlobalNotification'
   */
  router.get('/global-notification/:id',
    accessTokenParser([SCOPE.READ.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    validator.globalNotification,
    async(req, res) => {

      const notificationSettingId = req.params.id;
      let globalNotification;

      if (notificationSettingId) {
        try {
          globalNotification = await GlobalNotificationSetting.findOne({ _id: notificationSettingId });
        }
        catch (err) {
          logger.error(`Error in finding a global notification setting with {_id: ${notificationSettingId}}`);
        }
      }

      return res.apiv3({ globalNotification });
    });

  /**
   * @swagger
   *
   *    /notification-setting/global-notification:
   *      post:
   *        tags: [NotificationSetting]
   *        security:
   *          - cookieAuth: []
   *        description: add global notification
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/GlobalNotificationParams'
   *        responses:
   *          200:
   *            description: Succeeded to add global notification
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    createdNotification:
   *                      type: object
   *                      description: notification param created
   *                      $ref: '#/components/schemas/GlobalNotification'
   */
  // eslint-disable-next-line max-len
  router.post('/global-notification',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    addActivity,
    validator.globalNotification,
    apiV3FormValidator,
    async(req, res) => {
      const {
        notifyType, toEmail, slackChannels, triggerPath, triggerEvents,
      } = req.body;

      let notification;

      if (notifyType === GlobalNotificationSettingType.MAIL) {
        notification = new GlobalNotificationMailSetting(crowi);
        notification.toEmail = toEmail;
      }
      if (notifyType === GlobalNotificationSettingType.SLACK) {
        notification = new GlobalNotificationSlackSetting(crowi);
        notification.slackChannels = slackChannels;
      }

      notification.triggerPath = triggerPath;
      notification.triggerEvents = triggerEvents || [];

      try {
        const createdNotification = await notification.save();

        const parameters = { action: SupportedAction.ACTION_ADMIN_GLOBAL_NOTIFICATION_SETTINGS_ADD };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ createdNotification }, 201);
      }
      catch (err) {
        const msg = 'Error occurred in updating global notification';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'post-globalNotification-failed'));
      }
    });

  /**
   * @swagger
   *
   *    /notification-setting/global-notification/{id}:
   *      put:
   *        tags: [NotificationSetting]
   *        description: update global notification
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: global notification id for updated
   *            schema:
   *              type: string
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/GlobalNotificationParams'
   *        responses:
   *          200:
   *            description: Succeeded to update global notification
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    createdNotification:
   *                      type: object
   *                      description: notification param updated
   *                      $ref: '#/components/schemas/GlobalNotification'
   */
  // eslint-disable-next-line max-len
  router.put('/global-notification/:id',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    addActivity,
    validator.globalNotification,
    apiV3FormValidator,
    async(req, res) => {
      const { id } = req.params;
      const {
        notifyType, toEmail, slackChannels, triggerPath, triggerEvents,
      } = req.body;

      const models = {
        [GlobalNotificationSettingType.MAIL]: GlobalNotificationMailSetting,
        [GlobalNotificationSettingType.SLACK]: GlobalNotificationSlackSetting,
      };

      try {
        let setting = await GlobalNotificationSetting.findOne({ _id: id });
        setting = setting.toObject();

        // when switching from one type to another,
        // remove toEmail from slack setting and slackChannels from mail setting
        if (setting.__t !== notifyType) {
          setting = models[setting.__t].hydrate(setting);
          setting.toEmail = undefined;
          setting.slackChannels = undefined;
          await setting.save();
          setting = setting.toObject();
        }

        if (notifyType === GlobalNotificationSettingType.MAIL) {
          setting = GlobalNotificationMailSetting.hydrate(setting);
          setting.toEmail = toEmail;
        }
        if (notifyType === GlobalNotificationSettingType.SLACK) {
          setting = GlobalNotificationSlackSetting.hydrate(setting);
          setting.slackChannels = slackChannels;
        }

        setting.__t = notifyType;
        setting.triggerPath = triggerPath;
        setting.triggerEvents = triggerEvents || [];

        const createdNotification = await setting.save();

        const parameters = { action: SupportedAction.ACTION_ADMIN_GLOBAL_NOTIFICATION_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ createdNotification });
      }
      catch (err) {
        const msg = 'Error occurred in updating global notification';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'post-globalNotification-failed'));
      }

    });


  /**
   * @swagger
   *
   *    /notification-setting/notify-for-page-grant:
   *      put:
   *        tags: [NotificationSetting]
   *        security:
   *          - cookieAuth: []
   *        description: Update settings for notify for page grant
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/NotifyForPageGrant'
   *        responses:
   *          200:
   *            description: Succeeded to settings for notify for page grant
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/NotifyForPageGrant'
   */
  // eslint-disable-next-line max-len
  router.put('/notify-for-page-grant',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    addActivity,
    validator.notifyForPageGrant,
    apiV3FormValidator,
    async(req, res) => {

      let requestParams = {
        'notification:owner-page:isEnabled': req.body.isNotificationForOwnerPageEnabled,
        'notification:group-page:isEnabled': req.body.isNotificationForGroupPageEnabled,
      };

      requestParams = removeNullPropertyFromObject(requestParams);

      try {
        await configManager.updateConfigs(requestParams);
        const responseParams = {
          isNotificationForOwnerPageEnabled: await crowi.configManager.getConfig('notification:owner-page:isEnabled'),
          isNotificationForGroupPageEnabled: await crowi.configManager.getConfig('notification:group-page:isEnabled'),
        };

        const parameters = { action: SupportedAction.ACTION_ADMIN_NOTIFICATION_GRANT_SETTINGS_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ responseParams });
      }
      catch (err) {
        const msg = 'Error occurred in updating notify for page grant';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-notify-for-page-grant-failed'));
      }

    });

  /**
   * @swagger
   *
   *    /notification-setting/global-notification/{id}/enabled:
   *      put:
   *        tags: [NotificationSetting]
   *        security:
   *          - cookieAuth: []
   *        description: toggle enabled global notification
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: notification id for updated
   *            schema:
   *              type: string
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  isEnabled:
   *                    type: boolean
   *                    description: is notification enabled
   *        responses:
   *          200:
   *            description: Succeeded to delete global notification pattern
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    id:
   *                      type: string
   *                      description: notification id
   */
  router.put('/global-notification/:id/enabled',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    addActivity,
    async(req, res) => {
      const { id } = req.params;
      const { isEnabled } = req.body;

      try {
        if (isEnabled) {
          await GlobalNotificationSetting.enable(id);
        }
        else {
          await GlobalNotificationSetting.disable(id);
        }

        const parameters = {
          action: isEnabled
            ? SupportedAction.ACTION_ADMIN_GLOBAL_NOTIFICATION_SETTINGS_ENABLED
            : SupportedAction.ACTION_ADMIN_GLOBAL_NOTIFICATION_SETTINGS_DISABLED,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ id });

      }
      catch (err) {
        const msg = 'Error occurred in toggle of global notification';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'toggle-globalNotification-failed'));
      }

    });

  /**
  * @swagger
  *
  *    /notification-setting/global-notification/{id}:
  *      delete:
  *        tags: [NotificationSetting]
  *        security:
  *          - cookieAuth: []
  *        description: delete global notification pattern
  *        parameters:
  *          - name: id
  *            in: path
  *            required: true
  *            description: id of global notification
  *            schema:
  *              type: string
  *        responses:
  *          200:
  *            description: Succeeded to delete global notification pattern
  *            content:
  *              application/json:
  *                schema:
  *                  description: deleted notification
  *                  $ref: '#/components/schemas/GlobalNotification'
  */
  router.delete('/global-notification/:id',
    accessTokenParser([SCOPE.WRITE.ADMIN.EXTERNAL_NOTIFICATION]),
    Strictly,
    adminRequired,
    addActivity,
    async(req, res) => {
      const { id } = req.params;

      try {
        const deletedNotificaton = await GlobalNotificationSetting.findOneAndRemove({ _id: id });

        const parameters = { action: SupportedAction.ACTION_ADMIN_GLOBAL_NOTIFICATION_SETTINGS_DELETE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3(deletedNotificaton);
      }
      catch (err) {
        const msg = 'Error occurred in delete global notification';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'delete-globalNotification-failed'));
      }

    });

  return router;
};
