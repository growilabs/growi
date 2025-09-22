/* eslint-disable @typescript-eslint/no-this-alias */
import http from 'http';
import path from 'path';

import { createTerminus } from '@godaddy/terminus';
import attachmentRoutes from '@growi/remark-attachment-refs/dist/server';
import lsxRoutes from '@growi/remark-lsx/dist/server/index.cjs';
import mongoose from 'mongoose';
import next from 'next';

import { KeycloakUserGroupSyncService } from '~/features/external-user-group/server/service/keycloak-user-group-sync';
import { LdapUserGroupSyncService } from '~/features/external-user-group/server/service/ldap-user-group-sync';
import { startCronIfEnabled as startOpenaiCronIfEnabled } from '~/features/openai/server/services/cron';
import { initializeOpenaiService } from '~/features/openai/server/services/openai';
import { checkPageBulkExportJobInProgressCronService } from '~/features/page-bulk-export/server/service/check-page-bulk-export-job-in-progress-cron';
import instanciatePageBulkExportJobCleanUpCronService, {
  pageBulkExportJobCleanUpCronService,
} from '~/features/page-bulk-export/server/service/page-bulk-export-job-clean-up-cron';
import instanciatePageBulkExportJobCronService from '~/features/page-bulk-export/server/service/page-bulk-export-job-cron';
import { startCron as startAccessTokenCron } from '~/server/service/access-token';
import { projectRoot } from '~/server/util/project-dir-utils';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import UserEvent from '../events/user';
import { accessTokenParser } from '../middlewares/access-token-parser';
import { aclService as aclServiceSingletonInstance } from '../service/acl';
import AppService from '../service/app';
import AttachmentService from '../service/attachment';
import { configManager as configManagerSingletonInstance } from '../service/config-manager';
import instanciateExportService from '../service/export';
import instanciateExternalAccountService from '../service/external-account';
import { FileUploader, getUploader } from '../service/file-uploader'; // eslint-disable-line no-unused-vars
import { G2GTransferPusherService, G2GTransferReceiverService } from '../service/g2g-transfer';
import GrowiBridgeService from '../service/growi-bridge';
import { initializeImportService } from '../service/import';
import { InstallerService } from '../service/installer';
import { normalizeData } from '../service/normalize-data';
import PageService from '../service/page';
import PageGrantService from '../service/page-grant';
import PageOperationService from '../service/page-operation';
import PassportService from '../service/passport';
import SearchService from '../service/search';
import { SlackIntegrationService } from '../service/slack-integration';
import { SocketIoService } from '../service/socket-io';
import UserGroupService from '../service/user-group';
import { UserNotificationService } from '../service/user-notification';
import { initializeYjsService } from '../service/yjs';
import { getModelSafely, getMongoUri, mongoOptions } from '../util/mongoose-utils';

import { setupModelsDependentOnCrowi } from './setup-models';


const logger = loggerFactory('growi:crowi');
const httpErrorHandler = require('../middlewares/http-error-handler');

const sep = path.sep;

class Crowi {

  /**
   * For retrieving other packages
   * @type {import('~/server/middlewares/access-token-parser').AccessTokenParser}
   */
  accessTokenParser;

  /** @type {ReturnType<typeof next>} */
  nextApp;

  /** @type {import('../service/config-manager').IConfigManagerForApp} */
  configManager;

  /** @type {import('../service/acl').AclService} */
  aclService;

  /** @type {AppService} */
  appService;

  /** @type {FileUploader} */
  fileUploadService;

  /** @type {import('../service/growi-info').GrowiInfoService} */
  growiInfoService;

  /** @type {import('../service/page').IPageService} */
  pageService;

  /** @type {import('../service/page-grant').default} */
  pageGrantService;

  /** @type {import('../service/page-operation').default} */
  pageOperationService;

  /** @type {PassportService} */
  passportService;

  /** @type {import('../service/rest-qiita-API')} */
  restQiitaAPIService;

  /** @type {SearchService} */
  searchService;

  /** @type {SlackIntegrationService} */
  slackIntegrationService;

  /** @type {SocketIoService} */
  socketIoService;

  /** @type UserNotificationService */
  userNotificationService;

  constructor() {
    this.version = getGrowiVersion();

    this.publicDir = path.join(projectRoot, 'public') + sep;
    this.resourceDir = path.join(projectRoot, 'resource') + sep;
    this.localeDir = path.join(this.resourceDir, 'locales') + sep;
    this.viewsDir = path.resolve(__dirname, '../views') + sep;
    this.tmpDir = path.join(projectRoot, 'tmp') + sep;
    this.cacheDir = path.join(this.tmpDir, 'cache');

    this.express = null;

    this.accessTokenParser = accessTokenParser;

    this.config = {};
    this.configManager = null;
    this.s2sMessagingService = null;
    this.g2gTransferPusherService = null;
    this.g2gTransferReceiverService = null;
    this.mailService = null;
    this.passportService = null;
    this.globalNotificationService = null;
    this.aclService = null;
    this.appService = null;
    this.fileUploadService = null;
    this.growiBridgeService = null;
    this.pluginService = null;
    this.searchService = null;
    this.socketIoService = null;
    this.syncPageStatusService = null;
    this.slackIntegrationService = null;
    this.inAppNotificationService = null;
    this.activityService = null;
    this.commentService = null;
    this.openaiThreadDeletionCronService = null;
    this.openaiVectorStoreFileDeletionCronService = null;

    this.tokens = null;

    /** @type {import('./setup-models').ModelsMapDependentOnCrowi} */
    this.models = {};

    this.env = process.env;
    this.node_env = this.env.NODE_ENV || 'development';

    this.port = this.env.PORT || 3000;

    this.events = {
      user: new UserEvent(this),
      page: new (require('../events/page'))(this),
      activity: new (require('../events/activity'))(this),
      bookmark: new (require('../events/bookmark'))(this),
      tag: new (require('../events/tag'))(this),
      admin: new (require('../events/admin'))(this),
    };
  }

}

Crowi.prototype.init = async function() {
  await this.setupDatabase();
  this.models = await setupModelsDependentOnCrowi(this);
  await this.setupConfigManager();
  await this.setupSessionConfig();

  // setup messaging services
  await this.setupS2sMessagingService();
  await this.setupSocketIoService();

  // customizeService depends on AppService
  // passportService depends on appService
  // export and import depends on setUpGrowiBridge
  await Promise.all([
    this.setUpApp(),
    this.setUpGrowiBridge(),
  ]);

  await Promise.all([
    this.setupGrowiInfoService(),
    this.setupPassport(),
    this.setupSearcher(),
    this.setupMailer(),
    this.setupSlackIntegrationService(),
    this.setupG2GTransferService(),
    this.setUpFileUpload(),
    this.setUpFileUploaderSwitchService(),
    this.setupAttachmentService(),
    this.setUpAcl(),
    this.setUpRestQiitaAPI(),
    this.setupUserGroupService(),
    this.setupExport(),
    this.setupImport(),
    this.setupGrowiPluginService(),
    this.setupPageService(),
    this.setupInAppNotificationService(),
    this.setupActivityService(),
    this.setupCommentService(),
    this.setupSyncPageStatusService(),
    this.setUpCustomize(), // depends on pluginService
  ]);

  await Promise.all([
    // globalNotification depends on slack and mailer
    this.setUpGlobalNotification(),
    this.setUpUserNotification(),
    // depends on passport service
    this.setupExternalAccountService(),
    this.setupExternalUserGroupSyncService(),

    // depends on AttachmentService
    this.setupOpenaiService(),
  ]);

  this.setupCron();

  await normalizeData();
};

/**
 * Execute functions that should be run after the express server is ready.
 */
Crowi.prototype.asyncAfterExpressServerReady = async function() {
  if (this.pageOperationService != null) {
    await this.pageOperationService.afterExpressServerReady();
  }
};


Crowi.prototype.isPageId = function(pageId) {
  if (!pageId) {
    return false;
  }

  if (typeof pageId === 'string' && pageId.match(/^[\da-f]{24}$/)) {
    return true;
  }

  return false;
};

Crowi.prototype.setConfig = function(config) {
  this.config = config;
};

Crowi.prototype.getConfig = function() {
  return this.config;
};

Crowi.prototype.getEnv = function() {
  return this.env;
};

/**
 * Wrapper function of mongoose.model()
 * @param {string} modelName
 * @returns {mongoose.Model}
 */
Crowi.prototype.model = function(modelName) {
  return getModelSafely(modelName);
};

// getter/setter of event instance
Crowi.prototype.event = function(name, event) {
  if (event) {
    this.events[name] = event;
  }

  return this.events[name];
};

Crowi.prototype.setupDatabase = function() {
  mongoose.Promise = global.Promise;

  // mongoUri = mongodb://user:password@host/dbname
  const mongoUri = getMongoUri();

  return mongoose.connect(mongoUri, mongoOptions);
};

Crowi.prototype.setupSessionConfig = async function() {
  const session = require('express-session');
  const sessionMaxAge = this.configManager.getConfig('security:sessionMaxAge') || 2592000000; // default: 30days
  const redisUrl = this.env.REDISTOGO_URL || this.env.REDIS_URI || this.env.REDIS_URL || null;
  const uid = require('uid-safe').sync;

  // generate pre-defined uid for healthcheck
  const healthcheckUid = uid(24);

  const sessionConfig = {
    rolling: true,
    secret: this.env.SECRET_TOKEN || 'this is default session secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: sessionMaxAge,
    },
    genid(req) {
      // return pre-defined uid when healthcheck
      if (req.path === '/_api/v3/healthcheck') {
        return healthcheckUid;
      }
      return uid(24);
    },
  };

  if (this.env.SESSION_NAME) {
    sessionConfig.name = this.env.SESSION_NAME;
  }

  // use Redis for session store
  if (redisUrl) {
    const redis = require('redis');
    const redisClient = redis.createClient({ url: redisUrl });
    const RedisStore = require('connect-redis')(session);
    sessionConfig.store = new RedisStore({ client: redisClient });
  }
  // use MongoDB for session store
  else {
    const MongoStore = require('connect-mongo');
    sessionConfig.store = MongoStore.create({ client: mongoose.connection.getClient() });
  }

  this.sessionConfig = sessionConfig;
};

Crowi.prototype.setupConfigManager = async function() {
  this.configManager = configManagerSingletonInstance;
  return this.configManager.loadConfigs();
};

Crowi.prototype.setupS2sMessagingService = async function() {
  const s2sMessagingService = require('../service/s2s-messaging')(this);
  if (s2sMessagingService != null) {
    s2sMessagingService.subscribe();
    this.configManager.setS2sMessagingService(s2sMessagingService);
    // add as a message handler
    s2sMessagingService.addMessageHandler(this.configManager);

    this.s2sMessagingService = s2sMessagingService;
  }
};

Crowi.prototype.setupSocketIoService = async function() {
  this.socketIoService = new SocketIoService(this);
};

Crowi.prototype.setupCron = function() {
  instanciatePageBulkExportJobCronService(this);
  checkPageBulkExportJobInProgressCronService.startCron();

  instanciatePageBulkExportJobCleanUpCronService(this);
  pageBulkExportJobCleanUpCronService.startCron();

  startOpenaiCronIfEnabled();
  startAccessTokenCron();
};

Crowi.prototype.getSlack = function() {
  return this.slack;
};

Crowi.prototype.getSlackLegacy = function() {
  return this.slackLegacy;
};

Crowi.prototype.getGlobalNotificationService = function() {
  return this.globalNotificationService;
};

Crowi.prototype.getUserNotificationService = function() {
  return this.userNotificationService;
};

Crowi.prototype.setupPassport = async function() {
  logger.debug('Passport is enabled');

  // initialize service
  if (this.passportService == null) {
    this.passportService = new PassportService(this);
  }
  this.passportService.setupSerializer();
  // setup strategies
  try {
    this.passportService.setupStrategyById('local');
    this.passportService.setupStrategyById('ldap');
    this.passportService.setupStrategyById('saml');
    this.passportService.setupStrategyById('oidc');
    this.passportService.setupStrategyById('google');
    this.passportService.setupStrategyById('github');
  }
  catch (err) {
    logger.error(err);
  }

  // add as a message handler
  if (this.s2sMessagingService != null) {
    this.s2sMessagingService.addMessageHandler(this.passportService);
  }

  return Promise.resolve();
};

Crowi.prototype.setupSearcher = async function() {
  this.searchService = new SearchService(this);
};

Crowi.prototype.setupMailer = async function() {
  const MailService = require('~/server/service/mail');
  this.mailService = new MailService(this);

  // add as a message handler
  if (this.s2sMessagingService != null) {
    this.s2sMessagingService.addMessageHandler(this.mailService);
  }
};

Crowi.prototype.autoInstall = async function() {
  const isInstalled = this.configManager.getConfig('app:installed');
  const username = this.configManager.getConfig('autoInstall:adminUsername');

  if (isInstalled || username == null) {
    return;
  }

  logger.info('Start automatic installation');

  const firstAdminUserToSave = {
    username,
    name: this.configManager.getConfig('autoInstall:adminName'),
    email: this.configManager.getConfig('autoInstall:adminEmail'),
    password: this.configManager.getConfig('autoInstall:adminPassword'),
    admin: true,
  };
  const globalLang = this.configManager.getConfig('autoInstall:globalLang');
  const allowGuestMode = this.configManager.getConfig('autoInstall:allowGuestMode');
  const serverDate = this.configManager.getConfig('autoInstall:serverDate');

  const installerService = new InstallerService(this);

  try {
    await installerService.install(firstAdminUserToSave, globalLang ?? 'en_US', {
      allowGuestMode,
      serverDate,
    });
  }
  catch (err) {
    logger.warn('Automatic installation failed.', err);
  }
};

Crowi.prototype.getTokens = function() {
  return this.tokens;
};

Crowi.prototype.start = async function() {
  const dev = process.env.NODE_ENV !== 'production';

  await this.init();
  await this.buildServer();

  // setup Next.js
  this.nextApp = next({ dev });
  await this.nextApp.prepare();

  // setup CrowiDev
  if (dev) {
    const CrowiDev = require('./dev');
    this.crowiDev = new CrowiDev(this);
    this.crowiDev.init();
  }

  const { express } = this;

  const app = (this.node_env === 'development') ? this.crowiDev.setupServer(express) : express;

  const httpServer = http.createServer(app);

  // setup terminus
  this.setupTerminus(httpServer);

  // attach to socket.io
  this.socketIoService.attachServer(httpServer);

  // Initialization YjsService
  initializeYjsService(this.socketIoService.io);

  await this.autoInstall();

  // listen
  const serverListening = httpServer.listen(this.port, () => {
    logger.info(`[${this.node_env}] Express server is listening on port ${this.port}`);
    if (this.node_env === 'development') {
      this.crowiDev.setupExpressAfterListening(express);
    }
  });

  // setup Express Routes
  this.setupRoutesForPlugins();
  this.setupRoutesAtLast();

  // setup Global Error Handlers
  this.setupGlobalErrorHandlers();

  // Execute this asynchronously after the express server is ready so it does not block the ongoing process
  this.asyncAfterExpressServerReady();

  return serverListening;
};

Crowi.prototype.buildServer = async function() {
  const env = this.node_env;
  const express = require('express')();

  require('./express-init')(this, express);

  // use bunyan
  if (env === 'production') {
    const expressBunyanLogger = require('express-bunyan-logger');
    const logger = loggerFactory('express');
    express.use(expressBunyanLogger({
      logger,
      excludes: ['*'],
    }));
  }
  // use morgan
  else {
    const morgan = require('morgan');
    express.use(morgan('dev'));
  }

  this.express = express;
};

Crowi.prototype.setupTerminus = function(server) {
  createTerminus(server, {
    signals: ['SIGINT', 'SIGTERM'],
    onSignal: async() => {
      logger.info('Server is starting cleanup');

      await mongoose.disconnect();
      return;
    },
    onShutdown: async() => {
      logger.info('Cleanup finished, server is shutting down');
    },
  });
};

Crowi.prototype.setupRoutesForPlugins = function() {
  lsxRoutes(this, this.express);
  attachmentRoutes(this, this.express);
};

/**
 * setup Express Routes
 * !! this must be at last because it includes '/*' route !!
 */
Crowi.prototype.setupRoutesAtLast = function() {
  require('../routes')(this, this.express);
};

/**
 * setup global error handlers
 * !! this must be after the Routes setup !!
 */
Crowi.prototype.setupGlobalErrorHandlers = function() {
  this.express.use(httpErrorHandler);
};

/**
 * require API for plugins
 *
 * @param {string} modulePath relative path from /lib/crowi/index.js
 * @return {module}
 *
 * @memberof Crowi
 */
Crowi.prototype.require = function(modulePath) {
  return require(modulePath);
};

/**
 * setup GlobalNotificationService
 */
Crowi.prototype.setUpGlobalNotification = async function() {
  const GlobalNotificationService = require('../service/global-notification');
  if (this.globalNotificationService == null) {
    this.globalNotificationService = new GlobalNotificationService(this);
  }
};

/**
 * setup UserNotificationService
 */
Crowi.prototype.setUpUserNotification = async function() {
  if (this.userNotificationService == null) {
    this.userNotificationService = new UserNotificationService(this);
  }
};

/**
 * setup AclService
 */
Crowi.prototype.setUpAcl = async function() {
  this.aclService = aclServiceSingletonInstance;
};

/**
 * setup CustomizeService
 */
Crowi.prototype.setUpCustomize = async function() {
  const CustomizeService = require('../service/customize');
  if (this.customizeService == null) {
    this.customizeService = new CustomizeService(this);
    this.customizeService.initCustomCss();
    this.customizeService.initCustomTitle();
    this.customizeService.initGrowiTheme();

    // add as a message handler
    if (this.s2sMessagingService != null) {
      this.s2sMessagingService.addMessageHandler(this.customizeService);
    }
  }
};

/**
 * setup AppService
 */
Crowi.prototype.setUpApp = async function() {
  if (this.appService == null) {
    this.appService = new AppService(this);

    // add as a message handler
    const isInstalled = this.configManager.getConfig('app:installed');
    if (this.s2sMessagingService != null && !isInstalled) {
      this.s2sMessagingService.addMessageHandler(this.appService);
    }
  }
};

/**
 * setup FileUploadService
 */
Crowi.prototype.setUpFileUpload = async function(isForceUpdate = false) {
  if (this.fileUploadService == null || isForceUpdate) {
    this.fileUploadService = getUploader(this);
  }
};

/**
 * setup FileUploaderSwitchService
 */
Crowi.prototype.setUpFileUploaderSwitchService = async function() {
  const FileUploaderSwitchService = require('../service/file-uploader-switch');
  this.fileUploaderSwitchService = new FileUploaderSwitchService(this);
  // add as a message handler
  if (this.s2sMessagingService != null) {
    this.s2sMessagingService.addMessageHandler(this.fileUploaderSwitchService);
  }
};

Crowi.prototype.setupGrowiInfoService = async function() {
  const { growiInfoService } = await import('../service/growi-info');
  this.growiInfoService = growiInfoService;
};

/**
 * setup AttachmentService
 */
Crowi.prototype.setupAttachmentService = async function() {
  if (this.attachmentService == null) {
    this.attachmentService = new AttachmentService(this);
  }
};

/**
 * setup RestQiitaAPIService
 */
Crowi.prototype.setUpRestQiitaAPI = async function() {
  const RestQiitaAPIService = require('../service/rest-qiita-API');
  if (this.restQiitaAPIService == null) {
    this.restQiitaAPIService = new RestQiitaAPIService(this);
  }
};

Crowi.prototype.setupUserGroupService = async function() {
  if (this.userGroupService == null) {
    this.userGroupService = new UserGroupService(this);
    return this.userGroupService.init();
  }
};

Crowi.prototype.setUpGrowiBridge = async function() {
  if (this.growiBridgeService == null) {
    this.growiBridgeService = new GrowiBridgeService(this);
  }
};

Crowi.prototype.setupExport = async function() {
  instanciateExportService(this);
};

Crowi.prototype.setupImport = async function() {
  initializeImportService(this);
};

Crowi.prototype.setupGrowiPluginService = async function() {
  const growiPluginService = await import('~/features/growi-plugin/server/services').then(mod => mod.growiPluginService);

  // download plugin repositories, if document exists but there is no repository
  // TODO: Cannot download unless connected to the Internet at setup.
  await growiPluginService.downloadNotExistPluginRepositories();
};

Crowi.prototype.setupPageService = async function() {
  if (this.pageGrantService == null) {
    this.pageGrantService = new PageGrantService(this);
  }
  // initialize after pageGrantService since pageService uses pageGrantService in constructor
  if (this.pageService == null) {
    this.pageService = new PageService(this);
    await this.pageService.createTtlIndex();
  }
  if (this.pageOperationService == null) {
    this.pageOperationService = new PageOperationService(this);
    await this.pageOperationService.init();
  }
};

Crowi.prototype.setupInAppNotificationService = async function() {
  const InAppNotificationService = require('../service/in-app-notification');
  if (this.inAppNotificationService == null) {
    this.inAppNotificationService = new InAppNotificationService(this);
  }
};

Crowi.prototype.setupActivityService = async function() {
  const ActivityService = require('../service/activity');
  if (this.activityService == null) {
    this.activityService = new ActivityService(this);
    await this.activityService.createTtlIndex();
  }
};

Crowi.prototype.setupCommentService = async function() {
  const CommentService = require('../service/comment');
  if (this.commentService == null) {
    this.commentService = new CommentService(this);
  }
};

Crowi.prototype.setupSyncPageStatusService = async function() {
  const SyncPageStatusService = require('../service/system-events/sync-page-status');
  if (this.syncPageStatusService == null) {
    this.syncPageStatusService = new SyncPageStatusService(this, this.s2sMessagingService, this.socketIoService);

    // add as a message handler
    if (this.s2sMessagingService != null) {
      this.s2sMessagingService.addMessageHandler(this.syncPageStatusService);
    }
  }
};

Crowi.prototype.setupSlackIntegrationService = async function() {
  if (this.slackIntegrationService == null) {
    this.slackIntegrationService = new SlackIntegrationService(this);
  }

  // add as a message handler
  if (this.s2sMessagingService != null) {
    this.s2sMessagingService.addMessageHandler(this.slackIntegrationService);
  }
};

Crowi.prototype.setupG2GTransferService = async function() {
  if (this.g2gTransferPusherService == null) {
    this.g2gTransferPusherService = new G2GTransferPusherService(this);
  }
  if (this.g2gTransferReceiverService == null) {
    this.g2gTransferReceiverService = new G2GTransferReceiverService(this);
  }
};

// execute after setupPassport
Crowi.prototype.setupExternalAccountService = function() {
  instanciateExternalAccountService(this.passportService);
};

// execute after setupPassport, s2sMessagingService, socketIoService
Crowi.prototype.setupExternalUserGroupSyncService = function() {
  this.ldapUserGroupSyncService = new LdapUserGroupSyncService(this.passportService, this.s2sMessagingService, this.socketIoService);
  this.keycloakUserGroupSyncService = new KeycloakUserGroupSyncService(this.s2sMessagingService, this.socketIoService);
};

Crowi.prototype.setupOpenaiService = function() {
  initializeOpenaiService(this);
};

export default Crowi;
