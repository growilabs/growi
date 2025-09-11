import { SupportedAction } from '~/interfaces/activity';
import loggerFactory from '~/utils/logger';

import { configManager } from '../service/config-manager';
import { exportService } from '../service/export';

const logger = loggerFactory('growi:routes:admin');

/* eslint-disable no-use-before-define */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = function(crowi, app) {
  const ApiResponse = require('../util/apiResponse');
  const importer = require('../util/importer')(crowi);

  const actions = {};

  const { check, param } = require('express-validator');

  const activityEvent = crowi.event('activity');

  const api = {};


  // Importer management
  actions.importer = {};
  actions.importer.api = api;
  api.validators = {};
  api.validators.importer = {};

  api.validators.importer.esa = function() {
    const validator = [
      check('importer:esa:team_name').not().isEmpty().withMessage('Error. Empty esa:team_name'),
      check('importer:esa:access_token').not().isEmpty().withMessage('Error. Empty esa:access_token'),
    ];
    return validator;
  };

  api.validators.importer.qiita = function() {
    const validator = [
      check('importer:qiita:team_name').not().isEmpty().withMessage('Error. Empty qiita:team_name'),
      check('importer:qiita:access_token').not().isEmpty().withMessage('Error. Empty qiita:access_token'),
    ];
    return validator;
  };


  // Export management
  actions.export = {};
  actions.export.api = api;
  api.validators.export = {};

  api.validators.export.download = function() {
    const validator = [
      // https://regex101.com/r/mD4eZs/6
      // prevent from pass traversal attack
      param('fileName').not().matches(/(\.\.\/|\.\.\\)/),
    ];
    return validator;
  };

  actions.export.download = (req, res) => {
    const { fileName } = req.params;
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: `${fileName} is invalid. Do not use path like '../'.` });
    }

    try {
      const zipFile = exportService.getFile(fileName);
      const parameters = {
        ip:  req.ip,
        endpoint: req.originalUrl,
        action: SupportedAction.ACTION_ADMIN_ARCHIVE_DATA_DOWNLOAD,
        user: req.user?._id,
        snapshot: {
          username: req.user?.username,
        },
      };
      crowi.activityService.createActivity(parameters);
      return res.download(zipFile);
    }
    catch (err) {
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
    const unexpectedKeys = receivedKeys.filter(key => !allowedKeys.includes(key));

    if (unexpectedKeys.length > 0) {
      logger.warn('Unexpected keys were found in request body.', { unexpectedKeys });
      res.json(ApiResponse.error('Invalid config keys provided.'));
      return false;
    }

    return true;
  }

  /**
   * save esa settings, update config cache, and response json
   *
   * @param {*} req
   * @param {*} res
   */
  actions.api.importerSettingEsa = async(req, res) => {
    const form = req.body;

    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json(ApiResponse.error('esa.io form is blank'));
    }

    const ALLOWED_KEYS = ['importer:esa:team_name', 'importer:esa:access_token'];
    if (!isValidFormKeys(form, ALLOWED_KEYS, res)) return;

    await configManager.updateConfigs(form);
    importer.initializeEsaClient(); // let it run in the back aftert res
    const parameters = { action: SupportedAction.ACTION_ADMIN_ESA_DATA_UPDATED };
    activityEvent.emit('update', res.locals.activity._id, parameters);
    return res.json(ApiResponse.success());
  };

  /**
   * save qiita settings, update config cache, and response json
   *
   * @param {*} req
   * @param {*} res
   */
  actions.api.importerSettingQiita = async(req, res) => {
    const form = req.body;

    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json(ApiResponse.error('Qiita form is blank'));
    }

    const ALLOWED_KEYS = ['importer:qiita:team_name', 'importer:qiita:access_token'];
    if (!isValidFormKeys(form, ALLOWED_KEYS, res)) return;

    await configManager.updateConfigs(form);
    importer.initializeQiitaClient(); // let it run in the back aftert res
    const parameters = { action: SupportedAction.ACTION_ADMIN_QIITA_DATA_UPDATED };
    activityEvent.emit('update', res.locals.activity._id, parameters);
    return res.json(ApiResponse.success());
  };

  /**
   * Import all posts from esa
   *
   * @param {*} req
   * @param {*} res
   */
  actions.api.importDataFromEsa = async(req, res) => {
    const user = req.user;
    let errors;

    try {
      errors = await importer.importDataFromEsa(user);
      const parameters = { action: SupportedAction.ACTION_ADMIN_ESA_DATA_IMPORTED };
      activityEvent.emit('update', res.locals.activity._id, parameters);
    }
    catch (err) {
      errors = [err];
    }

    if (errors.length > 0) {
      return res.json(ApiResponse.error(`<br> - ${errors.join('<br> - ')}`));
    }
    return res.json(ApiResponse.success());
  };

  /**
   * Import all posts from qiita
   *
   * @param {*} req
   * @param {*} res
   */
  actions.api.importDataFromQiita = async(req, res) => {
    const user = req.user;
    let errors;

    try {
      errors = await importer.importDataFromQiita(user);
      const parameters = { action: SupportedAction.ACTION_ADMIN_QIITA_DATA_IMPORTED };
      activityEvent.emit('update', res.locals.activity._id, parameters);
    }
    catch (err) {
      errors = [err];
    }

    if (errors.length > 0) {
      return res.json(ApiResponse.error(`<br> - ${errors.join('<br> - ')}`));
    }
    return res.json(ApiResponse.success());
  };

  /**
   * Test connection to esa and response result with json
   *
   * @param {*} req
   * @param {*} res
   */
  actions.api.testEsaAPI = async(req, res) => {
    try {
      await importer.testConnectionToEsa();
      const parameters = { action: SupportedAction.ACTION_ADMIN_CONNECTION_TEST_OF_ESA_DATA };
      activityEvent.emit('update', res.locals.activity._id, parameters);
      return res.json(ApiResponse.success());
    }
    catch (err) {
      return res.json(ApiResponse.error(err));
    }
  };

  /**
   * Test connection to qiita and response result with json
   *
   * @param {*} req
   * @param {*} res
   */
  actions.api.testQiitaAPI = async(req, res) => {
    try {
      await importer.testConnectionToQiita();
      const parameters = { action: SupportedAction.ACTION_ADMIN_CONNECTION_TEST_OF_QIITA_DATA };
      activityEvent.emit('update', res.locals.activity._id, parameters);
      return res.json(ApiResponse.success());
    }
    catch (err) {
      return res.json(ApiResponse.error(err));
    }
  };


  actions.api.searchBuildIndex = async function(req, res) {
    const search = crowi.getSearcher();
    if (!search) {
      return res.json(ApiResponse.error('ElasticSearch Integration is not set up.'));
    }

    try {
      search.buildIndex();
    }
    catch (err) {
      return res.json(ApiResponse.error(err));
    }

    return res.json(ApiResponse.success());
  };

  return actions;
};
