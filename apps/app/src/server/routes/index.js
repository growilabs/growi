import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import multer from 'multer';
import autoReap from 'multer-autoreap';

import { createVaultGatewayRouterWithDeps } from '~/features/growi-vault/server';
import { middlewareFactory as rateLimiterFactory } from '~/features/rate-limiter';

import { accessTokenParser } from '../middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '../middlewares/add-activity';
import adminRequiredFactory from '../middlewares/admin-required';
import apiV1FormValidator from '../middlewares/apiv1-form-validator';
import { setup as setupApplicationInstalled } from '../middlewares/application-installed';
import * as applicationNotInstalled from '../middlewares/application-not-installed';
import { setup as setupAutoReconnectToSearch } from '../middlewares/auto-reconnect-to-search';
import {
  excludeReadOnlyUser,
  excludeReadOnlyUserIfCommentNotAllowed,
} from '../middlewares/exclude-read-only-user';
import injectResetOrderByTokenMiddleware from '../middlewares/inject-reset-order-by-token-middleware';
import injectUserRegistrationOrderByTokenMiddleware from '../middlewares/inject-user-registration-order-by-token-middleware';
import * as loginFormValidator from '../middlewares/login-form-validator';
import loginRequiredFactory from '../middlewares/login-required';
import {
  generateUnavailableWhenMaintenanceModeMiddleware,
  generateUnavailableWhenMaintenanceModeMiddlewareForApi,
} from '../middlewares/unavailable-when-maintenance-mode';
import { createApiRouter } from '../util/createApiRouter';
import { setup as setupAdmin } from './admin';
import { setup as setupApiV3 } from './apiv3';
import * as attachment from './attachment';
import { routesFactory as attachmentApiRoutesFactory } from './attachment/api';
import { setup as setupComment } from './comment';
import * as forgotPassword from './forgot-password';
import { setup as setupLogin } from './login';
import { setup as setupLoginPassport } from './login-passport';
import nextFactory from './next';
import { setup as setupOgp } from './ogp';
import { setup as setupPage } from './page';
import { setup as setupSearch } from './search';
import { setup as setupTag } from './tag';
import * as userActivation from './user-activation';

/** @param {import('~/server/crowi').default} crowi Crowi instance */
export const setup = (crowi, app) => {
  autoReap.options.reapOnError = true; // continue reaping the file even if an error occurs

  const autoReconnectToSearch = setupAutoReconnectToSearch(crowi);
  const applicationInstalled = setupApplicationInstalled(crowi);
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const loginRequired = loginRequiredFactory(crowi, true);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const uploads = multer({ dest: `${crowi.tmpDir}uploads` });
  const page = setupPage(crowi, app);
  const login = setupLogin(crowi, app);
  const loginPassport = setupLoginPassport(crowi, app);
  const admin = setupAdmin(crowi, app);
  const attachmentApi = attachmentApiRoutesFactory(crowi).api;
  const comment = setupComment(crowi, app);
  const tag = setupTag(crowi, app);
  const search = setupSearch(crowi, app);
  const ogp = setupOgp(crowi);

  const next = nextFactory(crowi);

  const unavailableWhenMaintenanceMode =
    generateUnavailableWhenMaintenanceModeMiddleware(crowi);
  const unavailableWhenMaintenanceModeForApi =
    generateUnavailableWhenMaintenanceModeMiddlewareForApi(crowi);

  const [apiV3Router, apiV3AdminRouter, apiV3AuthRouter] = setupApiV3(
    crowi,
    app,
  );

  // Rate limiter
  app.use(rateLimiterFactory());

  // GROWI Vault git gateway — must be registered before the catch-all page routes
  app.use('/vault.git', createVaultGatewayRouterWithDeps(crowi));

  // API v3 for admin
  app.use('/_api/v3', apiV3AdminRouter);

  // API v3 for auth
  app.use('/_api/v3', apiV3AuthRouter);

  app.get('/_next/*', next.delegateToNext);

  app.get(
    '/',
    applicationInstalled,
    unavailableWhenMaintenanceMode,
    loginRequired,
    autoReconnectToSearch,
    next.delegateToNext,
  );

  app.get('/login/error/:reason', applicationInstalled, next.delegateToNext);
  app.get('/login', applicationInstalled, login.preLogin, next.delegateToNext);
  app.get('/invited', applicationInstalled, next.delegateToNext);
  // app.post('/login'                   , applicationInstalled, loginFormValidator.loginRules(), loginFormValidator.loginValidation, csrfProtection,  addActivity, loginPassport.loginWithLocal, loginPassport.loginWithLdap, loginPassport.loginFailure);

  // NOTE: get method "/admin/export/:fileName" should be loaded before "/admin/*"
  app.get(
    '/admin/export/:fileName',
    accessTokenParser([SCOPE.READ.ADMIN.EXPORT_DATA]),
    loginRequiredStrictly,
    adminRequired,
    admin.export.api.validators.export.download(),
    admin.export.download,
  );

  // TODO: If you want to use accessTokenParser, you need to add scope ANY e.g. accessTokenParser([SCOPE.READ.ADMIN.ANY])
  app.get(
    '/admin/*',
    applicationInstalled,
    loginRequiredStrictly,
    adminRequired,
    next.delegateToNext,
  );
  app.get(
    '/admin',
    applicationInstalled,
    loginRequiredStrictly,
    adminRequired,
    next.delegateToNext,
  );

  // installer
  app.get(
    '/installer',
    applicationNotInstalled.generateCheckerMiddleware(crowi),
    next.delegateToNext,
    applicationNotInstalled.redirectToTopOnError,
  );

  // OAuth
  app.get(
    '/passport/google',
    loginPassport.loginWithGoogle,
    loginPassport.loginFailureForExternalAccount,
  );
  app.get(
    '/passport/github',
    loginPassport.loginWithGitHub,
    loginPassport.loginFailureForExternalAccount,
  );
  app.get(
    '/passport/oidc',
    loginPassport.loginWithOidc,
    loginPassport.loginFailureForExternalAccount,
  );
  app.get(
    '/passport/saml',
    loginPassport.loginWithSaml,
    loginPassport.loginFailureForExternalAccount,
  );
  app.get(
    '/passport/google/callback',
    loginPassport.injectRedirectTo,
    loginPassport.loginPassportGoogleCallback,
    loginPassport.loginFailureForExternalAccount,
  );
  app.get(
    '/passport/github/callback',
    loginPassport.injectRedirectTo,
    loginPassport.loginPassportGitHubCallback,
    loginPassport.loginFailureForExternalAccount,
  );
  app.get(
    '/passport/oidc/callback',
    loginPassport.injectRedirectTo,
    loginPassport.loginPassportOidcCallback,
    loginPassport.loginFailureForExternalAccount,
  );
  app.post(
    '/passport/saml/callback',
    addActivity,
    loginPassport.injectRedirectTo,
    loginPassport.loginPassportSamlCallback,
    loginPassport.loginFailureForExternalAccount,
  );

  app.post(
    '/_api/login/testLdap',
    accessTokenParser([SCOPE.WRITE.USER_SETTINGS.EXTERNAL_ACCOUNT]),
    loginRequiredStrictly,
    loginFormValidator.loginRules(),
    loginFormValidator.loginValidation,
    loginPassport.testLdapCredentials,
  );

  // brand logo
  app.use('/attachment', attachment.getBrandLogoRouterFactory(crowi));

  /*
   * Routes below are unavailable when maintenance mode
   */

  // API v3
  app.use('/_api/v3', unavailableWhenMaintenanceModeForApi, apiV3Router);

  const apiV1Router = createApiRouter();

  apiV1Router.get(
    '/search',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    search.api.search,
  );

  // HTTP RPC Styled API (に徐々に移行していいこうと思う)
  apiV1Router.get(
    '/pages.updatePost',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    page.api.getUpdatePost,
  );
  apiV1Router.get(
    '/pages.getPageTag',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    page.api.getPageTag,
  );
  // allow posting to guests because the client doesn't know whether the user logged in
  apiV1Router.post(
    '/pages.remove',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    page.validator.remove,
    apiV1FormValidator,
    page.api.remove,
  ); // (Avoid from API Token)
  apiV1Router.post(
    '/pages.revertRemove',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    page.validator.revertRemove,
    apiV1FormValidator,
    page.api.revertRemove,
  ); // (Avoid from API Token)
  apiV1Router.post(
    '/pages.unlink',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    page.api.unlink,
  ); // (Avoid from API Token)
  apiV1Router.get(
    '/tags.list',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    tag.api.list,
  );
  apiV1Router.get(
    '/tags.search',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    tag.api.search,
  );
  apiV1Router.post(
    '/tags.update',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    tag.api.update,
  );
  apiV1Router.get(
    '/comments.get',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    comment.api.get,
  );
  apiV1Router.post(
    '/comments.add',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    comment.api.validators.add(),
    loginRequiredStrictly,
    excludeReadOnlyUserIfCommentNotAllowed,
    addActivity,
    comment.api.add,
  );
  apiV1Router.post(
    '/comments.update',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    comment.api.validators.add(),
    loginRequiredStrictly,
    excludeReadOnlyUserIfCommentNotAllowed,
    addActivity,
    comment.api.update,
  );
  apiV1Router.post(
    '/comments.remove',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUserIfCommentNotAllowed,
    addActivity,
    comment.api.remove,
  );

  apiV1Router.post(
    '/attachments.uploadProfileImage',
    accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    uploads.single('file'),
    autoReap,
    attachmentApi.uploadProfileImage,
  );
  apiV1Router.post(
    '/attachments.remove',
    accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    attachmentApi.remove,
  );
  apiV1Router.post(
    '/attachments.removeProfileImage',
    accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    attachmentApi.removeProfileImage,
  );

  // API v1
  app.use('/_api', unavailableWhenMaintenanceModeForApi, apiV1Router);

  app.use(unavailableWhenMaintenanceMode);

  app.get('/me', loginRequiredStrictly, next.delegateToNext);
  app.get('/me/*', loginRequiredStrictly, next.delegateToNext);

  app.use(
    '/attachment',
    accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT]),
    attachment.getRouterFactory(crowi),
  );
  app.use(
    '/download',
    accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT]),
    attachment.downloadRouterFactory(crowi),
  );

  app.get('/_search', loginRequired, next.delegateToNext);

  app.use(
    '/forgot-password',
    express
      .Router()
      .use(forgotPassword.checkForgotPasswordEnabledMiddlewareFactory(crowi))
      .get('/', forgotPassword.renderForgotPassword(crowi))
      .get(
        '/:token',
        injectResetOrderByTokenMiddleware,
        forgotPassword.renderResetPassword(crowi),
      )
      .use(forgotPassword.handleErrorsMiddleware(crowi)),
  );

  app.get('/_private-legacy-pages', next.delegateToNext);

  app.use(
    '/user-activation',
    express
      .Router()
      .get(
        '/:token',
        applicationInstalled,
        injectUserRegistrationOrderByTokenMiddleware,
        userActivation.renderUserActivationPage(crowi),
      )
      .use(userActivation.tokenErrorHandlerMiddeware(crowi)),
  );

  app.get('/share$', (req, res) => res.redirect('/'));
  app.get('/share/:linkId', next.delegateToNext);

  app.use(
    '/ogp',
    express
      .Router()
      .get(
        '/:pageId([0-9a-z]{0,})',
        loginRequired,
        ogp.pageIdRequired,
        ogp.ogpValidator,
        ogp.renderOgp,
      ),
  );

  app.get('/*/$', loginRequired, next.delegateToNext);
  app.get('/*', loginRequired, autoReconnectToSearch, next.delegateToNext);
};
