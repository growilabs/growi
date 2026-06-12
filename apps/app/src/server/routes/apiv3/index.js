import { factory as aiToolsRouteFactory } from '~/features/ai-tools/server/routes/apiv3';
import { factory as auditLogBulkExportRouteFactory } from '~/features/audit-log-bulk-export/server/routes/apiv3';
import growiPlugin from '~/features/growi-plugin/server/routes/apiv3/admin';
import {
  createVaultAdminRouterWithDeps,
  createVaultPageRouterWithDeps,
} from '~/features/growi-vault/server';
import { factory as openaiRouteFactory } from '~/features/openai/server/routes';
import { allreadyInstalledMiddleware } from '~/server/middlewares/application-not-installed';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import injectUserRegistrationOrderByTokenMiddleware from '../../middlewares/inject-user-registration-order-by-token-middleware';
import * as loginFormValidator from '../../middlewares/login-form-validator';
import * as registerFormValidator from '../../middlewares/register-form-validator';
import { setup as g2gTransfer } from './g2g-transfer';
import importRoute from './import';
import pageListing from './page-listing';
import { setup as securitySettings } from './security-settings';
import { factory as userRouteFactory } from './user';
import * as userActivation from './user-activation';

const _logger = loggerFactory('growi:routes:apiv3');

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
  require('./response').default(express, crowi);

  routerForAdmin.use('/healthcheck', require('./healthcheck').setup(crowi));

  // admin
  routerForAdmin.use('/admin-home', require('./admin-home').setup(crowi));
  routerForAdmin.use(
    '/markdown-setting',
    require('./markdown-setting').setup(crowi),
  );
  routerForAdmin.use(
    '/content-disposition-settings',
    require('./content-disposition-settings').setup(crowi),
  );
  routerForAdmin.use('/app-settings', require('./app-settings').setup(crowi));
  routerForAdmin.use(
    '/customize-setting',
    require('./customize-setting').setup(crowi),
  );
  routerForAdmin.use(
    '/notification-setting',
    require('./notification-setting').setup(crowi),
  );
  routerForAdmin.use('/users', require('./users').setup(crowi));
  routerForAdmin.use('/user-groups', require('./user-group').setup(crowi));
  routerForAdmin.use(
    '/external-user-groups',
    require('~/features/external-user-group/server/routes/apiv3/external-user-group')(
      crowi,
    ),
  );
  routerForAdmin.use('/export', require('./export').setup(crowi));
  routerForAdmin.use('/import', importRoute(crowi));
  routerForAdmin.use('/search', require('./search').setup(crowi));
  routerForAdmin.use('/security-setting', securitySettings(crowi));
  routerForAdmin.use('/mongo', require('./mongo').setup(crowi));
  routerForAdmin.use(
    '/slack-integration-settings',
    require('./slack-integration-settings').setup(crowi),
  );
  routerForAdmin.use(
    '/slack-integration-legacy-settings',
    require('./slack-integration-legacy-settings').setup(crowi),
  );
  routerForAdmin.use('/activity', require('./activity').setup(crowi));
  routerForAdmin.use('/g2g-transfer', g2gTransfer(crowi));
  routerForAdmin.use('/plugins', growiPlugin(crowi));

  // vault admin API (GET /status, POST /bootstrap, PUT /enabled, POST /reconcile)
  routerForAdmin.use('/vault', createVaultAdminRouterWithDeps(crowi));

  // auth
  const applicationInstalled =
    require('../../middlewares/application-installed').setup(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);
  const login = require('../login').setup(crowi, app);
  const loginPassport = require('../login-passport').setup(crowi, app);

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

  routerForAuth.use('/invited', require('./invited').setup(crowi));
  routerForAuth.use('/logout', require('./logout').setup(crowi));

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
    isInstalled
      ? allreadyInstalledMiddleware
      : require('./installer').setup(crowi),
  );

  if (!isInstalled) {
    return [router, routerForAdmin, routerForAuth];
  }

  router.use(
    '/in-app-notification',
    require('./in-app-notification').setup(crowi),
  );
  router.use(
    '/news',
    require('~/features/news/server/routes/news').default(crowi),
  );

  router.use('/personal-setting', require('./personal-setting').setup(crowi));
  router.use('/user-activities', require('./user-activities').setup(crowi));

  router.use(
    '/user-group-relations',
    require('./user-group-relation').setup(crowi),
  );
  router.use(
    '/external-user-group-relations',
    require('~/features/external-user-group/server/routes/apiv3/external-user-group-relation')(
      crowi,
    ),
  );

  router.use('/statistics', require('./statistics').setup(crowi));

  router.use('/search', require('./search').setup(crowi));

  router.use('/page', require('./page').setup(crowi));
  router.use('/pages', require('./pages').setup(crowi));
  router.use('/revisions', require('./revisions').setup(crowi));

  // vault user API (POST /page/reconcile) — loginRequired only, no adminRequired
  router.use('/vault', createVaultPageRouterWithDeps(crowi));

  router.use('/page-listing', pageListing(crowi));

  router.use('/share-links', require('./share-links').setup(crowi));

  router.use('/bookmarks', require('./bookmarks').setup(crowi));
  router.use('/attachment', require('./attachment').setup(crowi));

  router.use('/slack-integration', require('./slack-integration').setup(crowi));

  router.use('/staffs', require('./staffs').setup(crowi));

  router.use('/forgot-password', require('./forgot-password').setup(crowi));

  const user = require('../user').setup(crowi, null);
  router.get('/check-username', user.api.checkUsername);

  router.post(
    '/complete-registration',
    addActivity,
    injectUserRegistrationOrderByTokenMiddleware,
    userActivation.completeRegistrationRules(),
    userActivation.validateCompleteRegistration,
    userActivation.completeRegistrationAction(crowi),
  );

  router.use('/user-ui-settings', require('./user-ui-settings').setup());

  router.use('/bookmark-folder', require('./bookmark-folder').setup(crowi));
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
  router.use('/audit-log-bulk-export', auditLogBulkExportRouteFactory(crowi));

  router.use('/openai', openaiRouteFactory(crowi));

  router.use('/ai-tools', aiToolsRouteFactory(crowi));

  router.use('/user', userRouteFactory(crowi));

  return [router, routerForAdmin, routerForAuth];
};
