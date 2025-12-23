import { SCOPE } from '@growi/core/dist/interfaces';

import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { configManager } from '~/server/service/config-manager';
import { getGrowiVersion } from '~/utils/growi-version';

const express = require('express');

const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      SystemInformationParams:
 *        type: object
 *        properties:
 *          growiVersion:
 *            type: string
 *            description: GROWI version or '-'
 *            example: 7.1.0-RC.0
 *          nodeVersion:
 *            type: string
 *            description: node version or '-'
 *            example: 20.2.0
 *          npmVersion:
 *            type: string
 *            description: npm version or '-'
 *            example: 9.6.6
 *          pnpmVersion:
 *            type: string
 *            description: pnpm version or '-'
 *            example: 9.12.3
 *          envVars:
 *            type: object
 *            description: environment variables
 *            additionalProperties:
 *              type: string
 *            example:
 *              "FILE_UPLOAD": "mongodb"
 *              "APP_SITE_URL": "http://localhost:3000"
 *              "ELASTICSEARCH_URI": "http://elasticsearch:9200/growi"
 *              "ELASTICSEARCH_REQUEST_TIMEOUT": 15000
 *              "ELASTICSEARCH_REJECT_UNAUTHORIZED": true
 *              "OGP_URI": "http://ogp:8088"
 *          isV5Compatible:
 *            type: boolean
 *            description: This value is true if this GROWI is compatible v5.
 *            example: true
 *          isMaintenanceMode:
 *            type: boolean
 *            description: This value is true if this site is maintenance mode.
 *            example: false
 *      InstalledPluginsParams:
 *        type: object
 *        properties:
 *          installedPlugins:
 *            type: object
 *            description: installed plugins
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(
    crowi,
  );
  const adminRequired = require('../../middlewares/admin-required')(crowi);

  /**
   * @swagger
   *
   *    /admin-home/:
   *      get:
   *        tags: [AdminHome]
   *        summary: /admin-home
   *        security:
   *          - cookieAuth: []
   *        description: Get adminHome parameters
   *        responses:
   *          200:
   *            description: params of adminHome
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    adminHomeParams:
   *                      $ref: "#/components/schemas/SystemInformationParams"
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.TOP]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      const { getRuntimeVersions } = await import(
        '~/server/util/runtime-versions'
      );
      const runtimeVersions = await getRuntimeVersions();

      const adminHomeParams = {
        growiVersion: getGrowiVersion(),
        nodeVersion: runtimeVersions.node ?? '-',
        npmVersion: runtimeVersions.npm ?? '-',
        pnpmVersion: runtimeVersions.pnpm ?? '-',
        envVars: configManager.getManagedEnvVars(),
        isV5Compatible: configManager.getConfig('app:isV5Compatible'),
        isMaintenanceMode: configManager.getConfig('app:isMaintenanceMode'),
      };

      return res.apiv3({ adminHomeParams });
    },
  );

  return router;
};
