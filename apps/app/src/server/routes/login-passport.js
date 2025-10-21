import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import { ExternalAccountLoginError } from '~/models/vo/external-account-login-error';
import { getTranslation } from '~/server/service/i18next';
import { createRedirectToForUnauthenticated } from '~/server/util/createRedirectToForUnauthenticated';
import loggerFactory from '~/utils/logger';

import { externalAccountService } from '../service/external-account';

/* eslint-disable no-use-before-define */

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = function(crowi, app) {
  const logger = loggerFactory('growi:routes:login-passport');
  const passport = require('passport');
  const passportService = crowi.passportService;

  const activityEvent = crowi.event('activity');

  const ApiResponse = require('../util/apiResponse');

  const promisifiedPassportAuthentication = (strategyName, req, res) => {
    return new Promise((resolve, reject) => {
      passport.authenticate(strategyName, (err, response, info) => {
        if (res.headersSent) { // dirty hack -- 2017.09.25
          return; //              cz: somehow passport.authenticate called twice when ECONNREFUSED error occurred
        }

        logger.debug(`--- authenticate with ${strategyName} strategy ---`);

        if (err) {
          logger.error(`'${strategyName}' passport authentication error: `, err);
          reject(err);
        }

        logger.debug('response', response);
        logger.debug('info', info);

        // authentication failure
        if (!response) {
          reject(response);
        }

        resolve(response);
      })(req, res);
    });
  };

  /**
   * success handler
   * @param {*} req
   * @param {*} res
   */
  const loginSuccessHandler = async(req, res, user, action, isExternalAccount = false) => {

    // update lastLoginAt
    user.updateLastLoginAt(new Date(), (err, userData) => {
      if (err) {
        logger.error(`updateLastLoginAt dumps error: ${err}`);
        logger.debug(`updateLastLoginAt dumps error: ${err}`);
      }
    });

    const parameters = {
      ip:  req.ip,
      endpoint: req.originalUrl,
      action,
      user: req.user?._id,
      snapshot: {
        username: req.user.username,
      },
    };

    await crowi.activityService.createActivity(parameters);

    const redirectToForUnauthenticated = createRedirectToForUnauthenticated(req.user.status);
    const redirectTo = redirectToForUnauthenticated ?? res.locals.redirectTo ?? '/';

    if (isExternalAccount) {
      return res.safeRedirect(redirectTo);
    }

    return res.apiv3({ redirectTo });
  };

  const injectRedirectTo = (req, res, next) => {

    // Move "req.session.redirectTo" to "res.locals.redirectTo"
    // Because the session is regenerated when req.login() is called
    const redirectTo = req.session.redirectTo;
    if (redirectTo != null) {
      res.locals.redirectTo = redirectTo;
    }

    next();
  };

  const isEnableLoginWithLocalOrLdap = (req, res, next) => {
    if (!passportService.isLocalStrategySetup && !passportService.isLdapStrategySetup) {
      logger.error('LocalStrategy and LdapStrategy has not been set up');
      const error = new ErrorV3('message.strategy_has_not_been_set_up', '', undefined, { strategy: 'LocalStrategy and LdapStrategy' });
      return next(error);
    }

    return next();
  };

  const cannotLoginErrorHadnler = (req, res, next) => {
    // this is called when all login method is somehow failed without invoking 'return next(<any Error>)'
    const err = new ErrorV3('message.sign_in_failure');
    return next(err);
  };

  /**
   * middleware for login failure
   * @param {*} error
   * @param {*} req
   * @param {*} res
   * @param {*} next
   */
  const loginFailure = (error, req, res, next) => {

    const parameters = { action: SupportedAction.ACTION_USER_LOGIN_FAILURE };
    activityEvent.emit('update', res.locals.activity._id, parameters);
    return res.apiv3Err(error);
  };

  const loginFailureForExternalAccount = async(error, req, res, next) => {
    const parameters = {
      ip:  req.ip,
      endpoint: req.originalUrl,
      action: SupportedAction.ACTION_USER_LOGIN_FAILURE,
    };
    await crowi.activityService.createActivity(parameters);

    req.crowi = crowi;
    req.session.externalAccountLoginError = JSON.stringify(error);
    res.redirect('/login');
    return;
  };

  /**
   * return true(valid) or false(invalid)
   *
   *  true ... group filter is not defined or the user has one or more groups
   *  false ... group filter is defined and the user has any group
   *
   */
  function isValidLdapUserByGroupFilter(user) {
    let bool = true;
    if (user._groups != null) {
      if (user._groups.length === 0) {
        bool = false;
      }
    }
    return bool;
  }
  /**
   * middleware that login with LdapStrategy
   * @param {*} req
   * @param {*} res
   * @param {*} next
   */
  const loginWithLdap = async(req, res, next) => {
    if (!passportService.isLdapStrategySetup) {
      logger.debug('LdapStrategy has not been set up');
      return next();
    }

    if (!req.form.isValid) {
      return next(req.form.errors);
    }

    const providerId = 'ldap';
    const strategyName = 'ldapauth';
    let ldapAccountInfo;

    try {
      ldapAccountInfo = await promisifiedPassportAuthentication(strategyName, req, res);
    }
    catch (err) {
      logger.debug(err.message);
      return next(err);
    }

    // check groups for LDAP
    if (!isValidLdapUserByGroupFilter(ldapAccountInfo)) {
      return next(new ErrorV3('message.ldap_user_not_valid'));
    }

    /*
      * authentication success
      */
    // it is guaranteed that username that is input from form can be acquired
    // because this processes after authentication
    const ldapAccountId = passportService.getLdapAccountIdFromReq(req);
    const attrMapUsername = passportService.getLdapAttrNameMappedToUsername();
    const attrMapName = passportService.getLdapAttrNameMappedToName();
    const attrMapMail = passportService.getLdapAttrNameMappedToMail();
    const usernameToBeRegistered = ldapAccountInfo[attrMapUsername];
    const nameToBeRegistered = ldapAccountInfo[attrMapName];
    const mailToBeRegistered = ldapAccountInfo[attrMapMail];

    const userInfo = {
      id: ldapAccountId,
      username: usernameToBeRegistered,
      name: nameToBeRegistered,
      email: mailToBeRegistered,
    };

    let externalAccount;
    try {
      externalAccount = await externalAccountService.getOrCreateUser(userInfo, providerId);
    }
    catch (error) {
      return next(error);
    }

    // just in case the returned value is null or undefined
    if (externalAccount == null) {
      return next(new ErrorV3('message.external_account_not_exist'));
    }

    const user = (await externalAccount.populate('user')).user;

    // login
    await req.logIn(user, (err) => {
      if (err) {
        logger.debug(err.message);
        return next(err);
      }

      return loginSuccessHandler(req, res, user, SupportedAction.ACTION_USER_LOGIN_WITH_LDAP, true);
    });
  };

  /**
   * middleware that test credentials with LdapStrategy
   *
   * @param {*} req
   * @param {*} res
   */
  const testLdapCredentials = async(req, res) => {
    const { t } = await getTranslation({ lang: req.user.lang });

    if (!passportService.isLdapStrategySetup) {
      logger.debug('LdapStrategy has not been set up');
      return res.json(ApiResponse.success({
        status: 'warning',
        message: t('message.strategy_has_not_been_set_up', { strategy: 'LdapStrategy' }),
      }));
    }

    passport.authenticate('ldapauth', (err, user, info) => {
      if (res.headersSent) { // dirty hack -- 2017.09.25
        return; //              cz: somehow passport.authenticate called twice when ECONNREFUSED error occurred
      }

      if (err) { // DB Error
        logger.error('LDAP Server Error: ', err);
        return res.json(ApiResponse.success({
          status: 'warning',
          message: 'LDAP Server Error occured.',
          err,
        }));
      }
      if (info && info.message) {
        return res.json(ApiResponse.success({
          status: 'warning',
          message: info.message,
          ldapConfiguration: req.ldapConfiguration,
          ldapAccountInfo: req.ldapAccountInfo,
        }));
      }
      if (user) {
        // check groups
        if (!isValidLdapUserByGroupFilter(user)) {
          return res.json(ApiResponse.success({
            status: 'warning',
            message: 'This user does not belong to any groups designated by the group search filter.',
            ldapConfiguration: req.ldapConfiguration,
            ldapAccountInfo: req.ldapAccountInfo,
          }));
        }
        return res.json(ApiResponse.success({
          status: 'success',
          message: 'Successfully authenticated.',
          ldapConfiguration: req.ldapConfiguration,
          ldapAccountInfo: req.ldapAccountInfo,
        }));
      }
    })(req, res, () => {});
  };

  /**
   * middleware that login with LocalStrategy
   * @param {*} req
   * @param {*} res
   * @param {*} next
   */
  const loginWithLocal = (req, res, next) => {
    if (!passportService.isLocalStrategySetup) {
      logger.debug('LocalStrategy has not been set up');
      return next();
    }

    if (!req.form.isValid) {
      return next(req.form.errors);
    }

    passport.authenticate('local', (err, user, info) => {
      logger.debug('--- authenticate with LocalStrategy ---');
      logger.debug('user', user);
      logger.debug('info', info);

      if (err) { // DB Error
        logger.error('Database Server Error: ', err);
        return next(err);
      }
      if (!user) {
        return next();
      }
      req.logIn(user, (err) => {
        if (err) {
          logger.debug(err.message);
          return next(err);
        }

        return loginSuccessHandler(req, res, user, SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL);
      });
    })(req, res, next);
  };

  const loginWithGoogle = function(req, res, next) {
    if (!passportService.isGoogleStrategySetup) {
      logger.debug('GoogleStrategy has not been set up');
      const error = new ExternalAccountLoginError('message.strategy_has_not_been_set_up', { strategy: 'GoogleStrategy' });
      return next(error);
    }

    passport.authenticate('google', {
      scope: ['profile', 'email'],
    })(req, res);
  };

  const loginPassportGoogleCallback = async(req, res, next) => {
    const globalLang = crowi.configManager.getConfig('app:globalLang');

    const providerId = 'google';
    const strategyName = 'google';

    let response;
    try {
      response = await promisifiedPassportAuthentication(strategyName, req, res);
    }
    catch (err) {
      return next(new ExternalAccountLoginError(err.message));
    }

    let name;

    switch (globalLang) {
      case 'en_US':
        name = `${response.name.givenName} ${response.name.familyName}`;
        break;
      case 'ja_JP':
        name = `${response.name.familyName} ${response.name.givenName}`;
        break;
      default:
        name = `${response.name.givenName} ${response.name.familyName}`;
        break;
    }

    const userInfo = {
      id: response.id,
      username: response.displayName,
      name,
    };

    // Emails are not empty if it exists
    // See https://github.com/passport/express-4.x-facebook-example/blob/dfce5495d0313174a1b5039bab2c2dcda7e0eb61/views/profile.ejs
    // Both Facebook and Google use OAuth 2.0, the code is similar
    // See https://github.com/jaredhanson/passport-google-oauth2/blob/723e8f3e8e711275f89e0163e2c77cfebae33f25/README.md#examples
    if (response.emails != null) {
      userInfo.email = response.emails[0].value;
      userInfo.username = userInfo.email.slice(0, userInfo.email.indexOf('@'));
    }

    const externalAccount = await externalAccountService.getOrCreateUser(userInfo, providerId);
    if (!externalAccount) {
      return next(new ExternalAccountLoginError('message.sign_in_failure'));
    }

    const user = (await externalAccount.populate('user')).user;

    // login
    req.logIn(user, async(err) => {
      if (err) { logger.debug(err.message); return next(new ExternalAccountLoginError(err.message)) }

      return loginSuccessHandler(req, res, user, SupportedAction.ACTION_USER_LOGIN_WITH_GOOGLE, true);
    });
  };

  const loginWithGitHub = function(req, res, next) {
    if (!passportService.isGitHubStrategySetup) {
      logger.debug('GitHubStrategy has not been set up');
      const error = new ExternalAccountLoginError('message.strategy_has_not_been_set_up', { strategy: 'GitHubStrategy' });
      return next(error);
    }

    passport.authenticate('github')(req, res);
  };

  const loginPassportGitHubCallback = async(req, res, next) => {
    const providerId = 'github';
    const strategyName = 'github';

    let response;
    try {
      response = await promisifiedPassportAuthentication(strategyName, req, res);
    }
    catch (err) {
      return next(new ExternalAccountLoginError(err.message));
    }

    const userInfo = {
      id: response.id,
      username: response.username,
      name: response.displayName,
    };

    const externalAccount = await externalAccountService.getOrCreateUser(userInfo, providerId);
    if (!externalAccount) {
      return next(new ExternalAccountLoginError('message.sign_in_failure'));
    }

    const user = (await externalAccount.populate('user')).user;

    // login
    req.logIn(user, async(err) => {
      if (err) { logger.debug(err.message); return next(new ExternalAccountLoginError(err.message)) }

      return loginSuccessHandler(req, res, user, SupportedAction.ACTION_USER_LOGIN_WITH_GITHUB, true);
    });
  };

  const loginWithOidc = function(req, res, next) {
    if (!passportService.isOidcStrategySetup) {
      logger.debug('OidcStrategy has not been set up');
      const error = new ExternalAccountLoginError('message.strategy_has_not_been_set_up', { strategy: 'OidcStrategy' });
      return next(error);
    }

    passport.authenticate('oidc')(req, res);
  };

  const loginPassportOidcCallback = async(req, res, next) => {
    const providerId = 'oidc';
    const strategyName = 'oidc';
    const attrMapId = crowi.configManager.getConfig('security:passport-oidc:attrMapId');
    const attrMapUserName = crowi.configManager.getConfig('security:passport-oidc:attrMapUserName');
    const attrMapName = crowi.configManager.getConfig('security:passport-oidc:attrMapName');
    const attrMapMail = crowi.configManager.getConfig('security:passport-oidc:attrMapMail');

    let response;
    try {
      response = await promisifiedPassportAuthentication(strategyName, req, res);
    }
    catch (err) {
      logger.debug(err);
      return next(new ExternalAccountLoginError(err.message));
    }

    const userInfo = {
      id: response[attrMapId],
      username: response[attrMapUserName],
      name: response[attrMapName],
      email: response[attrMapMail],
    };
    logger.debug('mapping response to userInfo', userInfo, response, attrMapId, attrMapUserName, attrMapMail);

    const externalAccount = await externalAccountService.getOrCreateUser(userInfo, providerId);
    if (!externalAccount) {
      return new ExternalAccountLoginError('message.sign_in_failure');
    }

    // login
    const user = (await externalAccount.populate('user')).user;
    req.logIn(user, async(err) => {
      if (err) { logger.debug(err.message); return next(new ExternalAccountLoginError(err.message)) }

      return loginSuccessHandler(req, res, user, SupportedAction.ACTION_USER_LOGIN_WITH_OIDC, true);
    });
  };

  const loginWithSaml = function(req, res, next) {
    if (!passportService.isSamlStrategySetup) {
      logger.debug('SamlStrategy has not been set up');
      const error = new ExternalAccountLoginError('message.strategy_has_not_been_set_up', { strategy: 'SamlStrategy' });
      return next(error);
    }

    passport.authenticate('saml')(req, res);
  };

  const loginPassportSamlCallback = async(req, res, next) => {
    const providerId = 'saml';
    const strategyName = 'saml';
    const attrMapId = crowi.configManager.getConfig('security:passport-saml:attrMapId');
    const attrMapUsername = crowi.configManager.getConfig('security:passport-saml:attrMapUsername');
    const attrMapMail = crowi.configManager.getConfig('security:passport-saml:attrMapMail');
    const attrMapFirstName = crowi.configManager.getConfig('security:passport-saml:attrMapFirstName') || 'firstName';
    const attrMapLastName = crowi.configManager.getConfig('security:passport-saml:attrMapLastName') || 'lastName';

    let response;
    try {
      response = await promisifiedPassportAuthentication(strategyName, req, res);
    }
    catch (err) {
      return next(new ExternalAccountLoginError(err.message));
    }

    const userInfo = {
      id: response[attrMapId],
      username: response[attrMapUsername],
      email: response[attrMapMail],
    };

    // determine name
    const firstName = response[attrMapFirstName];
    const lastName = response[attrMapLastName];
    if (firstName != null || lastName != null) {
      userInfo.name = `${response[attrMapFirstName]} ${response[attrMapLastName]}`.trim();
    }

    // Attribute-based Login Control
    if (!crowi.passportService.verifySAMLResponseByABLCRule(response)) {
      return next(new ExternalAccountLoginError('Sign in failure due to insufficient privileges.'));
    }

    const externalAccount = await externalAccountService.getOrCreateUser(userInfo, providerId);
    if (!externalAccount) {
      return next(new ExternalAccountLoginError('message.sign_in_failure'));
    }

    const user = (await externalAccount.populate('user')).user;

    // login
    req.logIn(user, (err) => {
      if (err != null) {
        logger.error(err);
        return next(new ExternalAccountLoginError(err.message));
      }

      return loginSuccessHandler(req, res, user, SupportedAction.ACTION_USER_LOGIN_WITH_SAML, true);
    });
  };

  return {
    cannotLoginErrorHadnler,
    injectRedirectTo,
    isEnableLoginWithLocalOrLdap,
    loginFailure,
    loginFailureForExternalAccount,
    loginWithLdap,
    testLdapCredentials,
    loginWithLocal,
    loginWithGoogle,
    loginWithGitHub,
    loginWithOidc,
    loginWithSaml,
    loginPassportGoogleCallback,
    loginPassportGitHubCallback,
    loginPassportOidcCallback,
    loginPassportSamlCallback,
  };
};
