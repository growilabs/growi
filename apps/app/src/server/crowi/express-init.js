import { themesRootPath as presetThemesRootPath } from '@growi/preset-themes';
import bodyParser from 'body-parser';
import compression from 'compression';
import flash from 'connect-flash';
import cookieParser from 'cookie-parser';
import csrf from 'csurf';
import express from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import expressSession from 'express-session';
import helmet from 'helmet';
import methodOverride from 'method-override';
import passport from 'passport';
import qs from 'qs';

import { resolveFromRoot } from '~/server/util/project-dir-utils';

import {
  PLUGIN_EXPRESS_STATIC_DIR,
  PLUGIN_STORING_PATH,
} from '../../features/growi-plugin/server/consts/index.js';
import loggerFactory from '../../utils/logger/index.js';
import { setup as setupAutoReconnectToS2sMsgServer } from '../middlewares/auto-reconnect-to-s2s-msg-server.js';
import CertifyOrigin from '../middlewares/certify-origin.js';
import { denyUploadsDirectAccess } from '../middlewares/deny-uploads-direct-access.js';
import { setup as setupInjectCurrentuserToLocalvars } from '../middlewares/inject-currentuser-to-localvars.js';
import registerSafeRedirectFactory from '../middlewares/safe-redirect.js';
import avoidSessionRoutes from '../routes/avoid-session-routes.js';

const logger = loggerFactory('growi:crowi:express-init');

/**
 * @param {import('./index').default} crowi Crowi instance
 * @param {import('express').Express} app Express app
 */
export const setup = (crowi, app) => {
  const registerSafeRedirect = registerSafeRedirectFactory();
  const injectCurrentuserToLocalvars = setupInjectCurrentuserToLocalvars();
  const autoReconnectToS2sMsgServer = setupAutoReconnectToS2sMsgServer(crowi);

  const env = crowi.node_env;

  // see: https://qiita.com/nazomikan/items/9458d591a4831480098d
  // Cannot set a custom query parser after app.use() has been called: https://github.com/expressjs/express/issues/3454
  app.set('query parser', (str) => qs.parse(str, { arrayLimit: Infinity }));

  app.use(compression());

  const { configManager } = crowi;

  const trustProxyBool = configManager.getConfig('security:trustProxyBool');
  const trustProxyCsv = configManager.getConfig('security:trustProxyCsv');
  const trustProxyHops = configManager.getConfig('security:trustProxyHops');

  const trustProxy = trustProxyBool ?? trustProxyCsv ?? trustProxyHops;

  try {
    if (trustProxy != null) {
      const isNotSpec =
        [trustProxyBool, trustProxyCsv, trustProxyHops].filter(
          (trustProxy) => trustProxy != null,
        ).length !== 1;
      if (isNotSpec) {
        logger.warn(
          `If more than one TRUST_PROXY_ ~ environment variable is set, the values are set in the following order of inequality size (BOOL > CSV > HOPS) first. Set value: ${trustProxy}`,
        );
      }
      app.set('trust proxy', trustProxy);
    }
  } catch (err) {
    logger.error(err);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      expectCt: false,
      referrerPolicy: false,
      permittedCrossDomainPolicies: false,
    }),
  );

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

  const staticOption = crowi.node_env === 'production' ? { maxAge: '30d' } : {};
  // Deny direct access to uploaded files (publicDir/uploads/**) BEFORE static
  // serving. Uploads must be served only via the /attachment and /download
  // routes, which apply authorization, Content-Disposition and CSP headers.
  // see: src/server/middlewares/deny-uploads-direct-access.ts
  app.use('/uploads', denyUploadsDirectAccess);
  app.use(express.static(crowi.publicDir, staticOption));
  app.use(
    '/static/preset-themes',
    express.static(
      resolveFromRoot(
        `node_modules/@growi/preset-themes/${presetThemesRootPath}`,
      ),
    ),
  );
  app.use(PLUGIN_EXPRESS_STATIC_DIR, express.static(PLUGIN_STORING_PATH));

  app.use(methodOverride());

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
  app.use(
    csrf({
      ignoreMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'DELETE'],
      cookie: false,
    }),
  );

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
