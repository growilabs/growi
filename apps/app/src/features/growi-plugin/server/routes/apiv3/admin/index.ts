import { SCOPE } from '@growi/core/dist/interfaces';
import type { Request, Router } from 'express';
import express from 'express';
import { body, query } from 'express-validator';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { GrowiPlugin } from '../../../models';
import { growiPluginService } from '../../../services';

const ObjectID = mongoose.Types.ObjectId;

/*
 * Validators
 */
const validator = {
  pluginIdisRequired: [
    query('id').isMongoId().withMessage('pluginId is required'),
  ],
  pluginFormValueisRequired: [
    body('pluginInstallerForm')
      .isString()
      .withMessage('pluginFormValue is required'),
  ],
};

module.exports = (crowi: Crowi): Router => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);

  const router = express.Router();

  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.PLUGIN]),
    loginRequiredStrictly,
    adminRequired,
    async (req: Request, res: ApiV3Response) => {
      try {
        const data = await GrowiPlugin.find({});
        return res.apiv3({ plugins: data });
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  /**
   * @swagger
   *
   * /plugins:
   *   post:
   *     tags: [Plugins]
   *     security:
   *       - cookieAuth: []
   *     summary: /plugins
   *     description: Install a plugin
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               pluginInstallerForm:
   *                 type: object
   *                 properties:
   *                   url:
   *                     type: string
   *                   ghBranch:
   *                     type: string
   *                   ghTag:
   *                     type: string
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 pluginName:
   *                   type: string
   *                   description: The name of the installed plugin
   *
   */
  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.ADMIN.PLUGIN]),
    loginRequiredStrictly,
    adminRequired,
    validator.pluginFormValueisRequired,
    async (req: Request, res: ApiV3Response) => {
      const { pluginInstallerForm: formValue } = req.body;

      try {
        const pluginName = await growiPluginService.install(formValue);
        return res.apiv3({ pluginName });
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  /**
   * @swagger
   *
   * /plugins/{id}/activate:
   *   put:
   *     tags: [Plugins]
   *     security:
   *       - cookieAuth: []
   *     summary: /plugins/{id}/activate
   *     description: Activate a plugin
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 pluginName:
   *                   type: string
   *                   description: The name of the activated plugin
   */
  router.put(
    '/:id/activate',
    accessTokenParser([SCOPE.WRITE.ADMIN.PLUGIN]),
    loginRequiredStrictly,
    adminRequired,
    validator.pluginIdisRequired,
    async (req: Request, res: ApiV3Response) => {
      const { id } = req.params;
      const pluginId = new ObjectID(id);

      try {
        const pluginName = await GrowiPlugin.activatePlugin(pluginId);
        return res.apiv3({ pluginName });
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  router.put(
    '/:id/deactivate',
    accessTokenParser([SCOPE.WRITE.ADMIN.PLUGIN]),
    loginRequiredStrictly,
    adminRequired,
    validator.pluginIdisRequired,
    async (req: Request, res: ApiV3Response) => {
      const { id } = req.params;
      const pluginId = new ObjectID(id);

      try {
        const pluginName = await GrowiPlugin.deactivatePlugin(pluginId);
        return res.apiv3({ pluginName });
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  /**
   * @swagger
   *
   * /plugins/{id}/remove:
   *   delete:
   *     tags: [Plugins]
   *     security:
   *       - cookieAuth: []
   *     summary: /plugins/{id}/remove
   *     description: Remove a plugin
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 pluginName:
   *                   type: string
   *                   description: The name of the removed plugin
   */
  router.delete(
    '/:id/remove',
    accessTokenParser([SCOPE.WRITE.ADMIN.PLUGIN]),
    loginRequiredStrictly,
    adminRequired,
    validator.pluginIdisRequired,
    async (req: Request, res: ApiV3Response) => {
      const { id } = req.params;
      const pluginId = new ObjectID(id);

      try {
        const pluginName = await growiPluginService.deletePlugin(pluginId);
        return res.apiv3({ pluginName });
      } catch (err) {
        return res.apiv3Err(err);
      }
    },
  );

  return router;
};
