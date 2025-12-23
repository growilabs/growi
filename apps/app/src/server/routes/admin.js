import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

import { exportService } from '../service/export';

const logger = loggerFactory('growi:routes:admin');

/* eslint-disable no-use-before-define */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const ApiResponse = require('../util/apiResponse');

  const actions = {};

  const { param } = require('express-validator');

  const api = {};

  // Export management
  actions.export = {};
  actions.export.api = api;
  api.validators = {};
  api.validators.export = {};

  api.validators.export.download = () => {
    const validator = [
      // https://regex101.com/r/mD4eZs/6
      // prevent from pass traversal attack
      param('fileName')
        .not()
        .matches(/(\.\.\/|\.\.\\)/),
    ];
    return validator;
  };

  actions.export.download = (req, res) => {
    const { fileName } = req.params;
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        errors: `${fileName} is invalid. Do not use path like '../'.`,
      });
    }

    try {
      const zipFile = exportService.getFile(fileName);
      const parameters = {
        ip: req.ip,
        endpoint: req.originalUrl,
        action: SupportedAction.ACTION_ADMIN_ARCHIVE_DATA_DOWNLOAD,
        user: req.user?._id,
        snapshot: {
          username: req.user?.username,
        },
      };
      crowi.activityService.createActivity(parameters);
      return res.download(zipFile);
    } catch (err) {
      // TODO: use ApiV3Error
      logger.error(err);
      return res.json(ApiResponse.error());
    }
  };

  actions.api = {};

  /**
   * Reject request if unexpected keys are present in form.
   * Logs the keys and returns error response.
   *
   * @param {Object} form
   * @param {Array<string>} allowedKeys
   * @param {Object} res
   * @returns {boolean}
   */
  function isValidFormKeys(form, allowedKeys, res) {
    const receivedKeys = Object.keys(form);
    const unexpectedKeys = receivedKeys.filter(
      (key) => !allowedKeys.includes(key),
    );

    if (unexpectedKeys.length > 0) {
      logger.warn('Unexpected keys were found in request body.', {
        unexpectedKeys,
      });
      res.json(ApiResponse.error('Invalid config keys provided.'));
      return false;
    }

    return true;
  }

  actions.api.searchBuildIndex = async (req, res) => {
    const search = crowi.getSearcher();
    if (!search) {
      return res.json(
        ApiResponse.error('ElasticSearch Integration is not set up.'),
      );
    }

    try {
      search.buildIndex();
    } catch (err) {
      return res.json(ApiResponse.error(err));
    }

    return res.json(ApiResponse.success());
  };

  return actions;
};
