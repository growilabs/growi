import { SCOPE } from '@growi/core/dist/interfaces';

import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import adminRequiredFactory from '~/server/middlewares/admin-required.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import loggerFactory from '~/utils/logger/index.js';

const _logger = loggerFactory('growi:routes:apiv3:mongo');

import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * @param {import('~/server/crowi').default} crowi Crowi instance
 * @returns {import('express').Router} router
 */
export const setup = (crowi) => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);

  /**
   * @swagger
   *
   *  /mongo/collections:
   *    get:
   *      tags: [MongoDB]
   *      summary: /mongo/collections
   *      description: get mongodb collections names
   *      responses:
   *        200:
   *          description: a list of collections in mongoDB
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  ok:
   *                    type: boolean
   *                    description: whether the request is succeeded
   *                  collections:
   *                    type: array
   *                    items:
   *                      type: string
   */
  router.get(
    '/collections',
    accessTokenParser([SCOPE.READ.ADMIN.EXPORT_DATA]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      const listCollectionsResult = await mongoose.connection.db
        .listCollections()
        .toArray();
      const collections = listCollectionsResult.map(
        (collectionObj) => collectionObj.name,
      );

      // TODO: use res.apiv3
      return res.json({
        ok: true,
        collections,
      });
    },
  );

  return router;
};
