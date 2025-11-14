import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { growiInfoService } from '../service/growi-info';

// disable all of linting
// because this file is a deprecated legacy of Crowi

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const logger = loggerFactory('growi:routes:login');
  const path = require('path');
  const User = crowi.model('User');
  const { appService, aclService, mailService, activityService } = crowi;
  const activityEvent = crowi.event('activity');

  const actions = {};

  async function sendEmailToAllAdmins(userData) {
    // send mails to all admin users (derived from crowi) -- 2020.06.18 Yuki Takei
    const admins = await User.findAdmins();
    const appTitle = appService.getAppTitle();
    const locale = configManager.getConfig('app:globalLang');

    const promises = admins.map((admin) => {
      return mailService.send({
        to: admin.email,
        subject: `[${appTitle}:admin] A New User Created and Waiting for Activation`,
        template: path.join(
          crowi.localeDir,
          `${locale}/admin/userWaitingActivation.ejs`,
        ),
        vars: {
          adminUser: admin,
          createdUser: userData,
          url: growiInfoService.getSiteUrl(),
          appTitle,
        },
      });
    });

    const results = await Promise.allSettled(promises);
    results
      .filter((result) => result.status === 'rejected')
      .forEach((result) => {
        logger.error(result.reason);
      });
  }

  async function sendNotificationToAllAdmins(user) {
    const activity = await activityService.createActivity({
      action: SupportedAction.ACTION_USER_REGISTRATION_APPROVAL_REQUEST,
      target: user,
      targetModel: SupportedTargetModel.MODEL_USER,
    });

    /**
     * @param {import('../service/pre-notify').PreNotifyProps} props
     */
    const preNotify = async (props) => {
      /** @type {(import('mongoose').HydratedDocument<import('@growi/core').IUser>)[]} */
      const adminUsers = await User.findAdmins();

      const { notificationTargetUsers } = props;
      notificationTargetUsers?.push(...adminUsers);
    };

    await activityEvent.emit('updated', activity, user, preNotify);
    return;
  }

  const registerSuccessHandler = async (
    req,
    res,
    userData,
    registrationMode,
  ) => {
    const parameters = {
      action: SupportedAction.ACTION_USER_REGISTRATION_SUCCESS,
    };
    activityEvent.emit('update', res.locals.activity._id, parameters);

    const isMailerSetup = mailService.isMailerSetup ?? false;

    if (
      registrationMode ===
      aclService.labels.SECURITY_REGISTRATION_MODE_RESTRICTED
    ) {
      sendNotificationToAllAdmins(userData);
      if (isMailerSetup) {
        await sendEmailToAllAdmins(userData);
      }
      return res.apiv3({});
    }

    /**
     * @swagger
     *
     * /login:
     *   post:
     *     summary: /login
     *     tags: [Users]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               loginForm:
     *                 type: object
     *                 properties:
     *                   username:
     *                     type: string
     *                   password:
     *                     type: string
     *     responses:
     *       200:
     *         description: Login successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 redirectTo:
     *                   type: string
     */
    req.login(userData, (err) => {
      if (err) {
        logger.debug(err);
      } else {
        // update lastLoginAt
        userData.updateLastLoginAt(new Date(), (err) => {
          if (err) {
            logger.error(`updateLastLoginAt dumps error: ${err}`);
          }
        });
      }

      let redirectTo;
      if (userData.password == null) {
        // userData.password can't be empty but, prepare redirect because password property in User Model is optional
        // https://github.com/growilabs/growi/pull/6670
        redirectTo = '/me#password_settings';
      } else if (req.session.redirectTo != null) {
        redirectTo = req.session.redirectTo;
        delete req.session.redirectTo;
      } else {
        redirectTo = '/';
      }

      return res.apiv3({ redirectTo });
    });
  };

  actions.preLogin = (req, res, next) => {
    // user has already logged in
    const { user } = req;
    if (user != null && user.status === User.STATUS_ACTIVE) {
      const { redirectTo } = req.session;
      // remove session.redirectTo
      delete req.session.redirectTo;
      return res.safeRedirect(redirectTo);
    }

    // set referer to 'redirectTo'
    if (req.session.redirectTo == null && req.headers.referer != null) {
      req.session.redirectTo = req.headers.referer;
    }

    next();
  };

  /**
   * @swagger
   *
   * /register:
   *   post:
   *     summary: /register
   *     tags: [Users]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               registerForm:
   *                 type: object
   *                 properties:
   *                   name:
   *                     type: string
   *                   username:
   *                     type: string
   *                   email:
   *                     type: string
   *                   password:
   *                     type: string
   *     responses:
   *       200:
   *         description: Register successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 redirectTo:
   *                   type: string
   */
  actions.register = (req, res) => {
    if (req.user != null) {
      return res.apiv3Err('message.user_already_logged_in', 403);
    }

    // config で closed ならさよなら
    if (
      configManager.getConfig('security:registrationMode') ===
      aclService.labels.SECURITY_REGISTRATION_MODE_CLOSED
    ) {
      return res.apiv3Err('message.registration_closed', 403);
    }

    if (!req.form.isValid) {
      const errors = req.form.errors;
      return res.apiv3Err(errors, 400);
    }

    const registerForm = req.form.registerForm || {};

    const name = registerForm.name;
    const username = registerForm.username;
    const email = registerForm.email;
    const password = registerForm.password;

    // email と username の unique チェックする
    User.isRegisterable(email, username, (isRegisterable, errOn) => {
      const errors = [];
      if (!User.isEmailValid(email)) {
        errors.push('message.email_address_could_not_be_used');
      }
      if (!isRegisterable) {
        if (!errOn.username) {
          errors.push('message.user_id_is_not_available');
        }
        if (!errOn.email) {
          errors.push('message.email_address_is_already_registered');
        }
      }
      if (errors.length > 0) {
        logger.debug('isError user register error', errOn);
        return res.apiv3Err(errors, 400);
      }

      const registrationMode = configManager.getConfig(
        'security:registrationMode',
      );

      User.createUserByEmailAndPassword(
        name,
        username,
        email,
        password,
        undefined,
        async (err, userData) => {
          if (err) {
            const errors = [];
            if (err.name === 'UserUpperLimitException') {
              errors.push('message.can_not_register_maximum_number_of_users');
            } else {
              errors.push('message.failed_to_register');
            }
            return res.apiv3Err(errors, 405);
          }
          return registerSuccessHandler(req, res, userData, registrationMode);
        },
      );
    });
  };

  return actions;
};
