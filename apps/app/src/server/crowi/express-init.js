import { themesRootPath as presetThemesRootPath } from '@growi/preset-themes';
import csrf from 'csurf';
import qs from 'qs';


import { PLUGIN_EXPRESS_STATIC_DIR, PLUGIN_STORING_PATH } from '../../features/growi-plugin/server/consts';
import loggerFactory from '../../utils/logger';
import { resolveFromRoot } from '~/server/util/project-dir-utils';
import CertifyOrigin from '../middlewares/certify-origin';

import registerSafeRedirectFactory from '../middlewares/safe-redirect';

const logger = loggerFactory('growi:crowi:express-init');

/** @param {import('./index').default} crowi Crowi instance */
module.exports = function(crowi, app) {
  const express = require('express');
  const compression = require('compression');
  const helmet = require('helmet');
  const bodyParser = require('body-parser');
  const cookieParser = require('cookie-parser');
  const methodOverride = require('method-override');
  const passport = require('passport');
  const expressSession = require('express-session');
  const flash = require('connect-flash');
  const mongoSanitize = require('express-mongo-sanitize');

  const registerSafeRedirect = registerSafeRedirectFactory();
  const injectCurrentuserToLocalvars = require('../middlewares/inject-currentuser-to-localvars')();
  const autoReconnectToS2sMsgServer = require('../middlewares/auto-reconnect-to-s2s-msg-server')(crowi);
  const avoidSessionRoutes = require('../routes/avoid-session-routes');

  const env = crowi.node_env;

  // see: https://qiita.com/nazomikan/items/9458d591a4831480098d
  // Cannot set a custom query parser after app.use() has been called: https://github.com/expressjs/express/issues/3454
  app.set('query parser', str => qs.parse(str, { arrayLimit: Infinity }));

  app.use(compression());


  const { configManager } = crowi;

  const trustProxyBool = configManager.getConfig('security:trustProxyBool');
  const trustProxyCsv = configManager.getConfig('security:trustProxyCsv');
  const trustProxyHops = configManager.getConfig('security:trustProxyHops');

  const trustProxy = trustProxyBool ?? trustProxyCsv ?? trustProxyHops;

  try {
    if (trustProxy != null) {
      const isNotSpec = [trustProxyBool, trustProxyCsv, trustProxyHops].filter(trustProxy => trustProxy != null).length !== 1;
      if (isNotSpec) {
        // eslint-disable-next-line max-len
        logger.warn(`If more than one TRUST_PROXY_ ~ environment variable is set, the values are set in the following order of inequality size (BOOL > CSV > HOPS) first. Set value: ${trustProxy}`);
      }
      app.set('trust proxy', trustProxy);
    }
  }
  catch (err) {
    logger.error(err);
  }

  app.use(helmet({
    contentSecurityPolicy: false,
    expectCt: false,
    referrerPolicy: false,
    permittedCrossDomainPolicies: false,
  }));

  app.use((req, res, next) => {
    const now = new Date();
    // for datez
    app.set('tzoffset', crowi.appService.getTzoffset());

    res.locals.req = req;
    res.locals.baseUrl = crowi.growiInfoService.getSiteUrl();
    res.locals.env = env;
    res.locals.now = now;

    next();
  });

  app.set('port', crowi.port);

  const staticOption = (crowi.node_env === 'production') ? { maxAge: '30d' } : {};
  app.use(express.static(crowi.publicDir, staticOption));
  app.use('/static/preset-themes', express.static(
    resolveFromRoot(`node_modules/@growi/preset-themes/${presetThemesRootPath}`),
  ));
  app.use(PLUGIN_EXPRESS_STATIC_DIR, express.static(PLUGIN_STORING_PATH));

  app.use(methodOverride());

  // inject rawBody to req
  app.use((req, res, next) => {
    if (!req.is('multipart/form-data')) {
      req.rawBody = '';
      req.on('data', (chunk) => {
        req.rawBody += chunk;
      });
    }

    next();
  });
  app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(cookieParser());

  // configure express-session
  const sessionMiddleware = expressSession(crowi.sessionConfig);
  app.use((req, res, next) => {
    // test whether the route is listed in avoidSessionRoutes
    for (const regex of avoidSessionRoutes) {
      if (regex.test(req.path)) {
        return next();
      }
    }

    sessionMiddleware(req, res, next);
  });

  // csurf should be initialized after express-session
  // default methods + PUT. See: https://expressjs.com/en/resources/middleware/csurf.html#ignoremethods
  app.use(csrf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'DELETE'], cookie: false }));

  app.use('/_api', CertifyOrigin);

  // passport
  logger.debug('initialize Passport');
  app.use(passport.initialize());
  app.use(passport.session());

  app.use(flash());
  app.use(mongoSanitize());

  app.use(registerSafeRedirect);
  app.use(injectCurrentuserToLocalvars);
  app.use(autoReconnectToS2sMsgServer);
};
