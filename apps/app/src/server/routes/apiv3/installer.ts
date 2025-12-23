import type { IUser } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, Router } from 'express';
import express from 'express';

import { SupportedAction } from '~/interfaces/activity';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import * as applicationNotInstalled from '../../middlewares/application-not-installed';
import {
  registerRules,
  registerValidation,
} from '../../middlewares/register-form-validator';
import {
  FailedToCreateAdminUserError,
  InstallerService,
} from '../../service/installer';
import type { ApiV3Response } from './interfaces/apiv3-response';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:routes:apiv3:installer');

type FormRequest = Request & { form: any; logIn: any };

module.exports = (crowi: Crowi): Router => {
  const addActivity = generateAddActivityMiddleware();

  const activityEvent = crowi.event('activity');

  const router = express.Router();

  // check application is not installed yet
  router.use(
    applicationNotInstalled.generateCheckerMiddleware(crowi),
    applicationNotInstalled.handleAsApiError,
  );

  const minPasswordLength = configManager.getConfig('app:minPasswordLength');

  /**
   * @swagger
   *
   *  /installer:
   *    post:
   *      tags: [Install]
   *      security: []
   *      summary: /installer
   *      description: Install GROWI
   *      requestBody:
   *        required: true
   *        content:
   *          application/json:
   *            schema:
   *              type: object
   *              properties:
   *                registerForm:
   *                  type: object
   *                  properties:
   *                    name:
   *                      type: string
   *                    username:
   *                      type: string
   *                    email:
   *                      type: string
   *                    password:
   *                      type: string
   *                    app:globalLang:
   *                      type: string
   *                      default: en_US
   *      responses:
   *        200:
   *          description: import settings params
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  message:
   *                    type: string
   *                    example: Installation completed (Logged in as an admin user)
   */
  // eslint-disable-next-line max-len
  router.post(
    '/',
    registerRules(minPasswordLength),
    registerValidation,
    addActivity,
    async (req: FormRequest, res: ApiV3Response) => {
      if (!req.form.isValid) {
        const errors = req.form.errors;
        return res.apiv3Err(errors, 400);
      }

      const registerForm = req.body.registerForm || {};

      const name = registerForm.name;
      const username = registerForm.username;
      const email = registerForm.email;
      const password = registerForm.password;
      const language = registerForm['app:globalLang'] || 'en_US';

      const installerService = new InstallerService(crowi);

      let adminUser: IUser;
      try {
        adminUser = await installerService.install(
          {
            name,
            username,
            email,
            password,
          },
          language,
        );
      } catch (err) {
        if (err instanceof FailedToCreateAdminUserError) {
          return res.apiv3Err(
            new ErrorV3(err.message, 'failed_to_create_admin_user'),
          );
        }
        return res.apiv3Err(new ErrorV3(err, 'failed_to_install'));
      }

      await crowi.appService.setupAfterInstall();

      const parameters = {
        action: SupportedAction.ACTION_USER_REGISTRATION_SUCCESS,
      };
      activityEvent.emit('update', res.locals.activity._id, parameters);

      // login with passport
      req.logIn(adminUser, (err) => {
        if (err != null) {
          return res.apiv3Err(
            new ErrorV3(err, 'failed_to_login_after_install'),
          );
        }

        return res.apiv3({
          message: 'Installation completed (Logged in as an admin user)',
        });
      });
    },
  );

  return router;
};
