import growiPlugin from '~/features/growi-plugin/server/routes/apiv3/admin';
import { factory as openaiRouteFactory } from '~/features/openai/server/routes';
import { allreadyInstalledMiddleware } from '~/server/middlewares/application-not-installed';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import injectUserRegistrationOrderByTokenMiddleware from '../../middlewares/inject-user-registration-order-by-token-middleware';
import * as loginFormValidator from '../../middlewares/login-form-validator';
import * as registerFormValidator from '../../middlewares/register-form-validator';
import g2gTransfer from './g2g-transfer';
import importRoute from './import';
import pageListing from './page-listing';
import securitySettings from './security-settings';
import { factory as userRouteFactory } from './user';
import * as userActivation from './user-activation';

const logger = loggerFactory('growi:routes:apiv3'); // eslint-disable-line no-unused-vars

const express = require('express');

const router = express.Router();
const routerForAdmin = express.Router();
const routerForAuth = express.Router();

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const isInstalled = crowi.configManager.getConfig('app:installed');
  const minPasswordLength = crowi.configManager.getConfig(
    'app:minPasswordLength',
  );

  // add custom functions to express response
  require('./response')(express, crowi);

  routerForAdmin.use('/healthcheck', require('./healthcheck')(crowi));

  // admin
  routerForAdmin.use('/admin-home', require('./admin-home')(crowi));
  routerForAdmin.use('/markdown-setting', require('./markdown-setting')(crowi));
  routerForAdmin.use('/app-settings', require('./app-settings')(crowi));
  routerForAdmin.use(
    '/customize-setting',
    require('./customize-setting')(crowi),
  );
  routerForAdmin.use(
    '/notification-setting',
    require('./notification-setting')(crowi),
  );
  routerForAdmin.use('/users', require('./users')(crowi));
  routerForAdmin.use('/user-groups', require('./user-group')(crowi));
  routerForAdmin.use(
    '/external-user-groups',
    require('~/features/external-user-group/server/routes/apiv3/external-user-group')(
      crowi,
    ),
  );
  routerForAdmin.use('/export', require('./export')(crowi));
  routerForAdmin.use('/import', importRoute(crowi));
  routerForAdmin.use('/search', require('./search')(crowi));
  routerForAdmin.use('/security-setting', securitySettings(crowi));
  routerForAdmin.use('/mongo', require('./mongo')(crowi));
  routerForAdmin.use(
    '/slack-integration-settings',
    require('./slack-integration-settings')(crowi),
  );
  routerForAdmin.use(
    '/slack-integration-legacy-settings',
    require('./slack-integration-legacy-settings')(crowi),
  );
  routerForAdmin.use('/activity', require('./activity')(crowi));
  routerForAdmin.use('/g2g-transfer', g2gTransfer(crowi));
  routerForAdmin.use('/plugins', growiPlugin(crowi));

  // auth
  const applicationInstalled =
    require('../../middlewares/application-installed')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);
  const login = require('../login')(crowi, app);
  const loginPassport = require('../login-passport')(crowi, app);

  routerForAuth.post(
    '/login',
    applicationInstalled,
    loginFormValidator.loginRules(),
    loginFormValidator.loginValidation,
    addActivity,
    loginPassport.injectRedirectTo,
    loginPassport.isEnableLoginWithLocalOrLdap,
    loginPassport.loginWithLocal,
    loginPassport.loginWithLdap,
    loginPassport.cannotLoginErrorHadnler,
    loginPassport.loginFailure,
  );

  routerForAuth.use('/invited', require('./invited')(crowi));
  routerForAuth.use('/logout', require('./logout')(crowi));

  routerForAuth.post(
    '/register',
    applicationInstalled,
    registerFormValidator.registerRules(minPasswordLength),
    registerFormValidator.registerValidation,
    addActivity,
    login.register,
  );

  routerForAuth.post(
    '/user-activation/register',
    applicationInstalled,
    userActivation.registerRules(minPasswordLength),
    userActivation.validateRegisterForm,
    userActivation.registerAction(crowi),
  );

  // installer
  routerForAdmin.use(
    '/installer',
    isInstalled ? allreadyInstalledMiddleware : require('./installer')(crowi),
  );

  if (!isInstalled) {
    return [router, routerForAdmin, routerForAuth];
  }

  router.use('/in-app-notification', require('./in-app-notification')(crowi));

  router.use('/personal-setting', require('./personal-setting')(crowi));
  router.use('/user-activities', require('./user-activities')(crowi));

  router.use('/user-group-relations', require('./user-group-relation')(crowi));
  router.use(
    '/external-user-group-relations',
    require('~/features/external-user-group/server/routes/apiv3/external-user-group-relation')(
      crowi,
    ),
  );

  router.use('/statistics', require('./statistics')(crowi));

  router.use('/search', require('./search')(crowi));

  router.use('/page', require('./page')(crowi));
  router.use('/pages', require('./pages')(crowi));
  router.use('/revisions', require('./revisions')(crowi));

  router.use('/page-listing', pageListing(crowi));

  router.use('/share-links', require('./share-links')(crowi));

  router.use('/bookmarks', require('./bookmarks')(crowi));
  router.use('/attachment', require('./attachment')(crowi));

  router.use('/slack-integration', require('./slack-integration')(crowi));

  router.use('/staffs', require('./staffs')(crowi));

  router.use('/forgot-password', require('./forgot-password')(crowi));

  const user = require('../user')(crowi, null);
  router.get('/check-username', user.api.checkUsername);

  router.post(
    '/complete-registration',
    addActivity,
    injectUserRegistrationOrderByTokenMiddleware,
    userActivation.completeRegistrationRules(),
    userActivation.validateCompleteRegistration,
    userActivation.completeRegistrationAction(crowi),
  );

  router.use('/user-ui-settings', require('./user-ui-settings')(crowi));

  router.use('/bookmark-folder', require('./bookmark-folder')(crowi));
  router.use(
    '/templates',
    require('~/features/templates/server/routes/apiv3')(crowi),
  );
  router.use(
    '/page-bulk-export',
    require('~/features/page-bulk-export/server/routes/apiv3/page-bulk-export')(
      crowi,
    ),
  );

  router.use('/openai', openaiRouteFactory(crowi));

  router.use('/user', userRouteFactory(crowi));

  return [router, routerForAdmin, routerForAuth];
};
