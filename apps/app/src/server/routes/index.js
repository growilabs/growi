import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';

import { middlewareFactory as rateLimiterFactory } from '~/features/rate-limiter';

import { accessTokenParser } from '../middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '../middlewares/add-activity';
import apiV1FormValidator from '../middlewares/apiv1-form-validator';
import * as applicationNotInstalled from '../middlewares/application-not-installed';
import { excludeReadOnlyUser, excludeReadOnlyUserIfCommentNotAllowed } from '../middlewares/exclude-read-only-user';
import injectResetOrderByTokenMiddleware from '../middlewares/inject-reset-order-by-token-middleware';
import injectUserRegistrationOrderByTokenMiddleware from '../middlewares/inject-user-registration-order-by-token-middleware';
import * as loginFormValidator from '../middlewares/login-form-validator';
import {
  generateUnavailableWhenMaintenanceModeMiddleware, generateUnavailableWhenMaintenanceModeMiddlewareForApi,
} from '../middlewares/unavailable-when-maintenance-mode';

import * as attachment from './attachment';
import { routesFactory as attachmentApiRoutesFactory } from './attachment/api';
import * as forgotPassword from './forgot-password';
import nextFactory from './next';
import * as userActivation from './user-activation';


const multer = require('multer');
const autoReap = require('multer-autoreap');

autoReap.options.reapOnError = true; // continue reaping the file even if an error occurs

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = function(crowi, app) {
  const autoReconnectToSearch = require('../middlewares/auto-reconnect-to-search')(crowi);
  const applicationInstalled = require('../middlewares/application-installed')(crowi);
  const loginRequiredStrictly = require('../middlewares/login-required')(crowi);
  const loginRequired = require('../middlewares/login-required')(crowi, true);
  const adminRequired = require('../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const uploads = multer({ dest: `${crowi.tmpDir}uploads` });
  const page = require('./page')(crowi, app);
  const login = require('./login')(crowi, app);
  const loginPassport = require('./login-passport')(crowi, app);
  const admin = require('./admin')(crowi, app);
  const attachmentApi = attachmentApiRoutesFactory(crowi).api;
  const comment = require('./comment')(crowi, app);
  const tag = require('./tag')(crowi, app);
  const search = require('./search')(crowi, app);
  const ogp = require('./ogp')(crowi);
  const { createApiRouter } = require('~/server/util/createApiRouter');

  const next = nextFactory(crowi);

  const unavailableWhenMaintenanceMode = generateUnavailableWhenMaintenanceModeMiddleware(crowi);
  const unavailableWhenMaintenanceModeForApi = generateUnavailableWhenMaintenanceModeMiddlewareForApi(crowi);


  /* eslint-disable max-len, comma-spacing, no-multi-spaces */

  const [apiV3Router, apiV3AdminRouter, apiV3AuthRouter] = require('./apiv3')(crowi, app);

  // Rate limiter
  app.use(rateLimiterFactory());

  // API v3 for admin
  app.use('/_api/v3', apiV3AdminRouter);

  // API v3 for auth
  app.use('/_api/v3', apiV3AuthRouter);

  app.get('/_next/*'                  , next.delegateToNext);

  app.get('/'                         ,  applicationInstalled, unavailableWhenMaintenanceMode, loginRequired, autoReconnectToSearch, next.delegateToNext);

  app.get('/login/error/:reason'      , applicationInstalled, next.delegateToNext);
  app.get('/login'                    , applicationInstalled, login.preLogin, next.delegateToNext);
  app.get('/invited'                  , applicationInstalled, next.delegateToNext);
  // app.post('/login'                   , applicationInstalled, loginFormValidator.loginRules(), loginFormValidator.loginValidation, csrfProtection,  addActivity, loginPassport.loginWithLocal, loginPassport.loginWithLdap, loginPassport.loginFailure);

  // NOTE: get method "/admin/export/:fileName" should be loaded before "/admin/*"
  app.get('/admin/export/:fileName'   , accessTokenParser([SCOPE.READ.ADMIN.EXPORT_DATA]), loginRequiredStrictly , adminRequired ,admin.export.api.validators.export.download(), admin.export.download);

  // TODO: If you want to use accessTokenParser, you need to add scope ANY e.g. accessTokenParser([SCOPE.READ.ADMIN.ANY])
  app.get('/admin/*'                  , applicationInstalled, loginRequiredStrictly , adminRequired , next.delegateToNext);
  app.get('/admin'                    , applicationInstalled, loginRequiredStrictly , adminRequired , next.delegateToNext);

  // installer
  app.get('/installer',
    applicationNotInstalled.generateCheckerMiddleware(crowi),
    next.delegateToNext,
    applicationNotInstalled.redirectToTopOnError);

  // OAuth
  app.get('/passport/google'                      , loginPassport.loginWithGoogle, loginPassport.loginFailureForExternalAccount);
  app.get('/passport/github'                      , loginPassport.loginWithGitHub, loginPassport.loginFailureForExternalAccount);
  app.get('/passport/oidc'                        , loginPassport.loginWithOidc,   loginPassport.loginFailureForExternalAccount);
  app.get('/passport/saml'                        , loginPassport.loginWithSaml,   loginPassport.loginFailureForExternalAccount);
  app.get('/passport/google/callback'             , loginPassport.injectRedirectTo, loginPassport.loginPassportGoogleCallback   , loginPassport.loginFailureForExternalAccount);
  app.get('/passport/github/callback'             , loginPassport.injectRedirectTo, loginPassport.loginPassportGitHubCallback   , loginPassport.loginFailureForExternalAccount);
  app.get('/passport/oidc/callback'               , loginPassport.injectRedirectTo, loginPassport.loginPassportOidcCallback     , loginPassport.loginFailureForExternalAccount);
  app.post('/passport/saml/callback'              , addActivity, loginPassport.injectRedirectTo, loginPassport.loginPassportSamlCallback, loginPassport.loginFailureForExternalAccount);

  app.post('/_api/login/testLdap'    ,  accessTokenParser([SCOPE.WRITE.USER_SETTINGS.EXTERNAL_ACCOUNT]), loginRequiredStrictly , loginFormValidator.loginRules() , loginFormValidator.loginValidation , loginPassport.testLdapCredentials);

  // importer management for admin
  app.post('/_api/admin/settings/importerEsa'   , accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA]), loginRequiredStrictly , adminRequired , addActivity, admin.importer.api.validators.importer.esa(),admin.api.importerSettingEsa);
  app.post('/_api/admin/settings/importerQiita' , accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA]), loginRequiredStrictly , adminRequired , addActivity, admin.importer.api.validators.importer.qiita(), admin.api.importerSettingQiita);
  app.post('/_api/admin/import/esa'             , accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA]), loginRequiredStrictly , adminRequired , addActivity, admin.api.importDataFromEsa);
  app.post('/_api/admin/import/testEsaAPI'      , accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA]), loginRequiredStrictly , adminRequired , addActivity, admin.api.testEsaAPI);
  app.post('/_api/admin/import/qiita'           , accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA]), loginRequiredStrictly , adminRequired , addActivity, admin.api.importDataFromQiita);
  app.post('/_api/admin/import/testQiitaAPI'    , accessTokenParser([SCOPE.WRITE.ADMIN.IMPORT_DATA]), loginRequiredStrictly , adminRequired , addActivity, admin.api.testQiitaAPI);

  // brand logo
  app.use('/attachment', attachment.getBrandLogoRouterFactory(crowi));

  /*
   * Routes below are unavailable when maintenance mode
   */

  // API v3
  app.use('/_api/v3', unavailableWhenMaintenanceModeForApi, apiV3Router);

  const apiV1Router = createApiRouter();

  apiV1Router.get('/search'              , accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }) , loginRequired , search.api.search);

  // HTTP RPC Styled API (に徐々に移行していいこうと思う)
  apiV1Router.get('/pages.updatePost'    , accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequired, page.api.getUpdatePost);
  apiV1Router.get('/pages.getPageTag'    , accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }) , loginRequired , page.api.getPageTag);
  // allow posting to guests because the client doesn't know whether the user logged in
  apiV1Router.post('/pages.remove'       , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]), loginRequiredStrictly , excludeReadOnlyUser, page.validator.remove, apiV1FormValidator, page.api.remove); // (Avoid from API Token)
  apiV1Router.post('/pages.revertRemove' , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]), loginRequiredStrictly , excludeReadOnlyUser, page.validator.revertRemove, apiV1FormValidator, page.api.revertRemove); // (Avoid from API Token)
  apiV1Router.post('/pages.unlink'       , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]), loginRequiredStrictly , excludeReadOnlyUser, page.api.unlink); // (Avoid from API Token)
  apiV1Router.get('/tags.list'           , accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequired, tag.api.list);
  apiV1Router.get('/tags.search'         , accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequired, tag.api.search);
  apiV1Router.post('/tags.update'        , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly, excludeReadOnlyUser, addActivity, tag.api.update);
  apiV1Router.get('/comments.get'        , accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }) , loginRequired , comment.api.get);
  apiV1Router.post('/comments.add'       , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), comment.api.validators.add(), loginRequiredStrictly , excludeReadOnlyUserIfCommentNotAllowed, addActivity, comment.api.add);
  apiV1Router.post('/comments.update'    , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), comment.api.validators.add(), loginRequiredStrictly , excludeReadOnlyUserIfCommentNotAllowed, addActivity, comment.api.update);
  apiV1Router.post('/comments.remove'    , accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly , excludeReadOnlyUserIfCommentNotAllowed, addActivity, comment.api.remove);

  apiV1Router.post('/attachments.uploadProfileImage'   , accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], { acceptLegacy: true }), uploads.single('file'), accessTokenParser , loginRequiredStrictly , excludeReadOnlyUser, uploads.single('file'), autoReap, attachmentApi.uploadProfileImage);
  apiV1Router.post('/attachments.remove'               , accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], { acceptLegacy: true }), loginRequiredStrictly , excludeReadOnlyUser, addActivity ,attachmentApi.remove);
  apiV1Router.post('/attachments.removeProfileImage'   , accessTokenParser([SCOPE.WRITE.FEATURES.ATTACHMENT], { acceptLegacy: true }), loginRequiredStrictly , excludeReadOnlyUser, attachmentApi.removeProfileImage);

  // API v1
  app.use('/_api', unavailableWhenMaintenanceModeForApi, apiV1Router);

  app.use(unavailableWhenMaintenanceMode);

  app.get('/me'                                   , loginRequiredStrictly, next.delegateToNext);
  app.get('/me/*'                                 , loginRequiredStrictly, next.delegateToNext);

  app.use('/attachment', accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT]), attachment.getRouterFactory(crowi));
  app.use('/download', accessTokenParser([SCOPE.READ.FEATURES.ATTACHMENT]), attachment.downloadRouterFactory(crowi));

  app.get('/_search'                              , loginRequired, next.delegateToNext);

  app.use('/forgot-password', express.Router()
    .use(forgotPassword.checkForgotPasswordEnabledMiddlewareFactory(crowi))
    .get('/', forgotPassword.renderForgotPassword(crowi))
    .get('/:token', injectResetOrderByTokenMiddleware, forgotPassword.renderResetPassword(crowi))
    .use(forgotPassword.handleErrorsMiddleware(crowi)));

  app.get('/_private-legacy-pages', next.delegateToNext);

  app.use('/user-activation', express.Router()
    .get('/:token', applicationInstalled, injectUserRegistrationOrderByTokenMiddleware, userActivation.renderUserActivationPage(crowi))
    .use(userActivation.tokenErrorHandlerMiddeware(crowi)));

  app.get('/share$', (req, res) => res.redirect('/'));
  app.get('/share/:linkId', next.delegateToNext);

  app.use('/ogp', express.Router().get('/:pageId([0-9a-z]{0,})', loginRequired, ogp.pageIdRequired, ogp.ogpValidator, ogp.renderOgp));

  app.get('/*/$'                   , loginRequired, next.delegateToNext);
  app.get('/*'                     , loginRequired, autoReconnectToSearch, next.delegateToNext);

};
