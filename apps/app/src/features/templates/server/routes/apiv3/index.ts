import path from 'node:path';
import { GrowiPluginType } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import type { TemplateSummary } from '@growi/pluginkit/dist/v4';
import {
  getMarkdown,
  scanAllTemplates,
} from '@growi/pluginkit/dist/v4/server/index.cjs';
import express from 'express';
import { param, query } from 'express-validator';

import { PLUGIN_STORING_PATH } from '~/features/growi-plugin/server/consts';
import { GrowiPlugin } from '~/features/growi-plugin/server/models';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { resolveFromRoot } from '~/server/util/project-dir-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:templates');

const router = express.Router();

const validator = {
  list: [query('includeInvalidTemplates').optional().isBoolean()],
  get: [param('templateId').isString(), param('locale').isString()],
};

// cache object
let presetTemplateSummaries: TemplateSummary[];

module.exports = (crowi: Crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  /**
   * @swagger
   *
   * /templates:
   *   get:
   *     summary: /templates
   *     security:
   *       - cookieAuth: []
   *     description: Get all templates
   *     tags: [Templates]
   *     parameters:
   *       - name: includeInvalidTemplates
   *         in: query
   *         description: Whether to include invalid templates
   *         required: false
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summaries:
   *                   type: object
   *                   additionalProperties:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       isDefault:
   *                         type: boolean
   *                       isValid:
   *                         type: boolean
   *                       locale:
   *                         type: string
   *                       title:
   *                         type: string
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE]),
    loginRequiredStrictly,
    validator.list,
    apiV3FormValidator,
    async (req, res: ApiV3Response) => {
      const { includeInvalidTemplates } = req.query;

      // scan preset templates
      if (presetTemplateSummaries == null) {
        const presetTemplatesRoot = resolveFromRoot(
          'node_modules/@growi/preset-templates',
        );

        try {
          presetTemplateSummaries = await scanAllTemplates(
            presetTemplatesRoot,
            {
              returnsInvalidTemplates: includeInvalidTemplates,
            },
          );
        } catch (err) {
          logger.error(err);
          presetTemplateSummaries = [];
        }
      }

      // load plugin templates
      let pluginsTemplateSummaries: TemplateSummary[] = [];
      try {
        const plugins = await GrowiPlugin.findEnabledPluginsByType(
          GrowiPluginType.Template,
        );
        pluginsTemplateSummaries = plugins.flatMap(
          (p) => p.meta.templateSummaries,
        );
      } catch (err) {
        logger.error(err);
      }

      return res.apiv3({
        summaries: [...presetTemplateSummaries, ...pluginsTemplateSummaries],
      });
    },
  );

  /**
   * @swagger
   *
   * /templates/preset-templates/{templateId}/{locale}:
   *   get:
   *     tags: [Templates]
   *     summary: /templates/preset-templates/{templateId}/{locale}
   *     security:
   *       - cookieAuth: []
   *     description: Get a preset template
   *     parameters:
   *       - name: templateId
   *         in: path
   *         description: The template ID
   *         required: true
   *         schema:
   *           type: string
   *       - name: locale
   *         in: path
   *         description: The locale
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
   *                 markdown:
   *                   type: string
   */
  router.get(
    '/preset-templates/:templateId/:locale',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE]),
    loginRequiredStrictly,
    validator.get,
    apiV3FormValidator,
    async (req, res: ApiV3Response) => {
      const { templateId, locale } = req.params;

      const presetTemplatesRoot = resolveFromRoot(
        'node_modules/@growi/preset-templates',
      );

      try {
        const markdown = await getMarkdown(
          presetTemplatesRoot,
          templateId,
          locale,
        );
        return res.apiv3({ markdown });
      } catch (err) {
        res.apiv3Err(err);
      }
    },
  );

  /**
   * @swagger
   *
   * /templates/plugin-templates/{organizationId}/{reposId}/{templateId}/{locale}:
   *   get:
   *     tags: [Templates]
   *     summary: /templates/plugin-templates/{organizationId}/{reposId}/{templateId}/{locale}
   *     security:
   *       - cookieAuth: []
   *     description: Get a plugin template
   *     parameters:
   *       - name: organizationId
   *         in: path
   *         description: The organization ID
   *         required: true
   *         schema:
   *           type: string
   *       - name: reposId
   *         in: path
   *         description: The repository ID
   *         required: true
   *         schema:
   *           type: string
   *       - name: templateId
   *         in: path
   *         description: The template ID
   *         required: true
   *         schema:
   *           type: string
   *       - name: locale
   *         in: path
   *         description: The locale
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
   *                 markdown:
   *                   type: string
   */
  router.get(
    '/plugin-templates/:organizationId/:reposId/:templateId/:locale',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE]),
    loginRequiredStrictly,
    validator.get,
    apiV3FormValidator,
    async (req, res: ApiV3Response) => {
      const { organizationId, reposId, templateId, locale } = req.params;

      const pluginRoot = path.join(
        PLUGIN_STORING_PATH,
        `${organizationId}/${reposId}`,
      );

      try {
        const markdown = await getMarkdown(pluginRoot, templateId, locale);
        return res.apiv3({ markdown });
      } catch (err) {
        res.apiv3Err(err);
      }
    },
  );

  return router;
};
