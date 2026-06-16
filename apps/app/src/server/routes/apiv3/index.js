import express from 'express';

import { factory as aiToolsRouteFactory } from '~/features/ai-tools/server/routes/apiv3';
import { factory as auditLogBulkExportRouteFactory } from '~/features/audit-log-bulk-export/server/routes/apiv3';
import { setup as setupExternalUserGroup } from '~/features/external-user-group/server/routes/apiv3/external-user-group';
import { setup as setupExternalUserGroupRelation } from '~/features/external-user-group/server/routes/apiv3/external-user-group-relation';
import { setup as growiPlugin } from '~/features/growi-plugin/server/routes/apiv3/admin';
import {
  createVaultAdminRouterWithDeps,
  createVaultPageRouterWithDeps,
} from '~/features/growi-vault/server';
import newsRoute from '~/features/news/server/routes/news';
import { factory as openaiRouteFactory } from '~/features/openai/server/routes';
import { setup as setupPageBulkExport } from '~/features/page-bulk-export/server/routes/apiv3/page-bulk-export';
import { setup as setupTemplates } from '~/features/templates/server/routes/apiv3';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { setup as setupApplicationInstalled } from '../../middlewares/application-installed';
import { allreadyInstalledMiddleware } from '../../middlewares/application-not-installed';
import injectUserRegistrationOrderByTokenMiddleware from '../../middlewares/inject-user-registration-order-by-token-middleware';
import * as loginFormValidator from '../../middlewares/login-form-validator';
import * as registerFormValidator from '../../middlewares/register-form-validator';
import { setup as setupLogin } from '../login';
import { setup as setupLoginPassport } from '../login-passport';
import { setup as setupUser } from '../user';
import { setup as setupActivity } from './activity';
import { setup as setupAdminHome } from './admin-home';
import { setup as setupAppSettings } from './app-settings';
import { setup as setupAttachment } from './attachment';
import { setup as setupBookmarkFolder } from './bookmark-folder';
import { setup as setupBookmarks } from './bookmarks';
import { setup as setupContentDispositionSettings } from './content-disposition-settings';
import { setup as setupCustomizeSetting } from './customize-setting';
import { setup as setupExport } from './export';
import { setup as setupForgotPassword } from './forgot-password';
import { setup as g2gTransfer } from './g2g-transfer';
import { setup as setupHealthcheck } from './healthcheck';
import importRoute from './import';
import { setup as setupInAppNotification } from './in-app-notification';
import { setup as setupInstaller } from './installer';
import { setup as setupInvited } from './invited';
import { setup as setupLogout } from './logout';
import { setup as setupMarkdownSetting } from './markdown-setting';
import { setup as setupMongo } from './mongo';
import { setup as setupNotificationSetting } from './notification-setting';
import { setup as setupPage } from './page';
import pageListing from './page-listing';
import { setup as setupPages } from './pages';
import { setup as setupPersonalSetting } from './personal-setting';
import addCustomFunctionToResponse from './response';
import { setup as setupRevisions } from './revisions';
import { setup as setupSearch } from './search';
import { setup as securitySettings } from './security-settings';
import { setup as setupShareLinks } from './share-links';
import { setup as setupSlackIntegration } from './slack-integration';
import { setup as setupSlackIntegrationLegacySettings } from './slack-integration-legacy-settings';
import { setup as setupSlackIntegrationSettings } from './slack-integration-settings';
import { setup as setupStaffs } from './staffs';
import { setup as setupStatistics } from './statistics';
import { factory as userRouteFactory } from './user';
import * as userActivation from './user-activation';
import { setup as setupUserActivities } from './user-activities';
import { setup as setupUserGroup } from './user-group';
import { setup as setupUserGroupRelation } from './user-group-relation';
import { setup as setupUserUiSettings } from './user-ui-settings';
import { setup as setupUsers } from './users';

const _logger = loggerFactory('growi:routes:apiv3');

const router = express.Router();
const routerForAdmin = express.Router();
const routerForAuth = express.Router();

/**
 * @param {import('~/server/crowi').default} crowi Crowi instance
 * @param {import('express').Express} app Express app
 * @returns {import('express').Router[]} [router, routerForAdmin, routerForAuth]
 */
export const setup = (crowi, app) => {
  const isInstalled = crowi.configManager.getConfig('app:installed');
  const minPasswordLength = crowi.configManager.getConfig(
    'app:minPasswordLength',
  );

  // add custom functions to express response
  addCustomFunctionToResponse(express, crowi);

  routerForAdmin.use('/healthcheck', setupHealthcheck(crowi));

  // admin
  routerForAdmin.use('/admin-home', setupAdminHome(crowi));
  routerForAdmin.use('/markdown-setting', setupMarkdownSetting(crowi));
  routerForAdmin.use(
    '/content-disposition-settings',
    setupContentDispositionSettings(crowi),
  );
  routerForAdmin.use('/app-settings', setupAppSettings(crowi));
  routerForAdmin.use('/customize-setting', setupCustomizeSetting(crowi));
  routerForAdmin.use('/notification-setting', setupNotificationSetting(crowi));
  routerForAdmin.use('/users', setupUsers(crowi));
  routerForAdmin.use('/user-groups', setupUserGroup(crowi));
  routerForAdmin.use('/external-user-groups', setupExternalUserGroup(crowi));
  routerForAdmin.use('/export', setupExport(crowi));
  routerForAdmin.use('/import', importRoute(crowi));
  routerForAdmin.use('/search', setupSearch(crowi));
  routerForAdmin.use('/security-setting', securitySettings(crowi));
  routerForAdmin.use('/mongo', setupMongo(crowi));
  routerForAdmin.use(
    '/slack-integration-settings',
    setupSlackIntegrationSettings(crowi),
  );
  routerForAdmin.use(
    '/slack-integration-legacy-settings',
    setupSlackIntegrationLegacySettings(crowi),
  );
  routerForAdmin.use('/activity', setupActivity(crowi));
  routerForAdmin.use('/g2g-transfer', g2gTransfer(crowi));
  routerForAdmin.use('/plugins', growiPlugin(crowi));

  // vault admin API (GET /status, POST /bootstrap, PUT /enabled, POST /reconcile)
  routerForAdmin.use('/vault', createVaultAdminRouterWithDeps(crowi));

  // auth
  const applicationInstalled = setupApplicationInstalled(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);
  const login = setupLogin(crowi, app);
  const loginPassport = setupLoginPassport(crowi, app);

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

  routerForAuth.use('/invited', setupInvited(crowi));
  routerForAuth.use('/logout', setupLogout(crowi));

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
    isInstalled ? allreadyInstalledMiddleware : setupInstaller(crowi),
  );

  if (!isInstalled) {
    return [router, routerForAdmin, routerForAuth];
  }

  router.use('/in-app-notification', setupInAppNotification(crowi));
  router.use('/news', newsRoute(crowi));

  router.use('/personal-setting', setupPersonalSetting(crowi));
  router.use('/user-activities', setupUserActivities(crowi));

  router.use('/user-group-relations', setupUserGroupRelation(crowi));
  router.use(
    '/external-user-group-relations',
    setupExternalUserGroupRelation(crowi),
  );

  router.use('/statistics', setupStatistics(crowi));

  router.use('/search', setupSearch(crowi));

  router.use('/page', setupPage(crowi));
  router.use('/pages', setupPages(crowi));
  router.use('/revisions', setupRevisions(crowi));

  // vault user API (POST /page/reconcile) — loginRequired only, no adminRequired
  router.use('/vault', createVaultPageRouterWithDeps(crowi));

  router.use('/page-listing', pageListing(crowi));

  router.use('/share-links', setupShareLinks(crowi));

  router.use('/bookmarks', setupBookmarks(crowi));
  router.use('/attachment', setupAttachment(crowi));

  router.use('/slack-integration', setupSlackIntegration(crowi));

  router.use('/staffs', setupStaffs(crowi));

  router.use('/forgot-password', setupForgotPassword(crowi));

  const user = setupUser(crowi, null);
  router.get('/check-username', user.api.checkUsername);

  router.post(
    '/complete-registration',
    addActivity,
    injectUserRegistrationOrderByTokenMiddleware,
    userActivation.completeRegistrationRules(),
    userActivation.validateCompleteRegistration,
    userActivation.completeRegistrationAction(crowi),
  );

  router.use('/user-ui-settings', setupUserUiSettings());

  router.use('/bookmark-folder', setupBookmarkFolder(crowi));
  router.use('/templates', setupTemplates(crowi));
  router.use('/page-bulk-export', setupPageBulkExport(crowi));
  router.use('/audit-log-bulk-export', auditLogBulkExportRouteFactory(crowi));

  router.use('/openai', openaiRouteFactory(crowi));

  router.use('/ai-tools', aiToolsRouteFactory(crowi));

  router.use('/user', userRouteFactory(crowi));

  return [router, routerForAdmin, routerForAuth];
};
