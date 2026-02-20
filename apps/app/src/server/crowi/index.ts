import next from 'next';
import http from 'node:http';
import path from 'node:path';
import { createTerminus } from '@godaddy/terminus';
import attachmentRoutes from '@growi/remark-attachment-refs/dist/server';
import lsxRoutes from '@growi/remark-lsx/dist/server/index.cjs';
import type { Express } from 'express';
import mongoose from 'mongoose';

import { KeycloakUserGroupSyncService } from '~/features/external-user-group/server/service/keycloak-user-group-sync';
import { LdapUserGroupSyncService } from '~/features/external-user-group/server/service/ldap-user-group-sync';
import { startCronIfEnabled as startOpenaiCronIfEnabled } from '~/features/openai/server/services/cron';
import { initializeOpenaiService } from '~/features/openai/server/services/openai';
import { checkPageBulkExportJobInProgressCronService } from '~/features/page-bulk-export/server/service/check-page-bulk-export-job-in-progress-cron';
import instanciatePageBulkExportJobCleanUpCronService from '~/features/page-bulk-export/server/service/page-bulk-export-job-clean-up-cron';
import instanciatePageBulkExportJobCronService from '~/features/page-bulk-export/server/service/page-bulk-export-job-cron';
import { startCron as startAccessTokenCron } from '~/server/service/access-token';
import { projectRoot } from '~/server/util/project-dir-utils';
import { getGrowiVersion } from '~/utils/growi-version';
import loggerFactory from '~/utils/logger';

import ActivityEvent from '../events/activity';
import AdminEvent from '../events/admin';
import BookmarkEvent from '../events/bookmark';
import PageEvent from '../events/page';
import TagEvent from '../events/tag';
import UserEvent from '../events/user';
import type { AccessTokenParser } from '../middlewares/access-token-parser';
import { accessTokenParser } from '../middlewares/access-token-parser';
import httpErrorHandler from '../middlewares/http-error-handler';
import loginRequiredFactory from '../middlewares/login-required';
import type { AclService } from '../service/acl';
import { aclService as aclServiceSingletonInstance } from '../service/acl';
import ActivityService from '../service/activity';
import AppService from '../service/app';
import { AttachmentService } from '../service/attachment';
import CommentService from '../service/comment';
import { configManager as configManagerSingletonInstance } from '../service/config-manager';
import type { ConfigManager } from '../service/config-manager/config-manager';
import instanciateExportService from '../service/export';
import instanciateExternalAccountService from '../service/external-account';
import { type FileUploader, getUploader } from '../service/file-uploader';
import {
  G2GTransferPusherService,
  G2GTransferReceiverService,
} from '../service/g2g-transfer';
import { GrowiBridgeService } from '../service/growi-bridge';
import { initializeImportService } from '../service/import';
import InAppNotificationService from '../service/in-app-notification';
import { InstallerService } from '../service/installer';
import { normalizeData } from '../service/normalize-data';
import PageService from '../service/page';
import PageGrantService from '../service/page-grant';
import type { IPageOperationService } from '../service/page-operation';
import instanciatePageOperationService from '../service/page-operation';
import PassportService from '../service/passport';
import SearchService from '../service/search';
import { SlackIntegrationService } from '../service/slack-integration';
import { SocketIoService } from '../service/socket-io';
import SyncPageStatusService from '../service/system-events/sync-page-status';
import UserGroupService from '../service/user-group';
import { UserNotificationService } from '../service/user-notification';
import { initializeYjsService } from '../service/yjs';
import { getMongoUri, mongoOptions } from '../util/mongoose-utils';
import type { ModelsMapDependentOnCrowi } from './setup-models';
import { setupModelsDependentOnCrowi } from './setup-models';

const logger = loggerFactory('growi:crowi');

const sep = path.sep;

type PageEventType = any;
type ActivityEventType = any;
type BookmarkEventType = any;
type TagEventType = any;
type AdminEventType = any;
type GlobalNotificationServiceType = any;
type S2sMessagingServiceType = any;
type MailServiceType = any;
type FileUploaderSwitchServiceType = any;
type InAppNotificationServiceType = any;
type ActivityServiceType = any;
type CommentServiceType = any;
type SyncPageStatusServiceType = any;
type CrowiDevType = any;

interface SessionConfig {
  rolling: boolean;
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: {
    maxAge: number;
  };
  genid: (req: { path: string }) => string;
  name?: string;
  store?: unknown;
}

interface CrowiEvents {
  user: UserEvent;
  page: PageEventType;
  activity: ActivityEventType;
  bookmark: BookmarkEventType;
  tag: TagEventType;
  admin: AdminEventType;
}

class Crowi {
  /**
   * For retrieving other packages
   */
  accessTokenParser: AccessTokenParser;

  loginRequiredFactory: typeof loginRequiredFactory;

  nextApp!: ReturnType<typeof next>;

  configManager!: ConfigManager;

  attachmentService!: AttachmentService;

  aclService!: AclService;

  appService!: AppService;

  fileUploadService!: FileUploader;

  growiInfoService!: import('../service/growi-info').GrowiInfoService;

  growiBridgeService!: GrowiBridgeService;

  pageService!: import('../service/page/page-service').IPageService;

  pageGrantService!: PageGrantService;

  pageOperationService!: IPageOperationService;

  customizeService!: import('../service/customize').CustomizeService;

  passportService!: PassportService;

  searchService!: SearchService;

  slackIntegrationService!: SlackIntegrationService;

  socketIoService!: SocketIoService;

  userNotificationService!: UserNotificationService;

  userGroupService!: UserGroupService;

  ldapUserGroupSyncService!: LdapUserGroupSyncService;

  keycloakUserGroupSyncService!: KeycloakUserGroupSyncService;

  globalNotificationService!: GlobalNotificationServiceType;

  sessionConfig!: SessionConfig;

  version: string;

  publicDir: string;

  resourceDir: string;

  localeDir: string;

  viewsDir: string;

  tmpDir: string;

  cacheDir: string;

  express!: Express;

  config: Record<string, unknown>;

  s2sMessagingService: S2sMessagingServiceType | null;

  g2gTransferPusherService: G2GTransferPusherService | null;

  g2gTransferReceiverService: G2GTransferReceiverService | null;

  mailService: MailServiceType | null;

  fileUploaderSwitchService!: FileUploaderSwitchServiceType;

  pluginService: unknown | null;

  syncPageStatusService: SyncPageStatusServiceType | null;

  inAppNotificationService: InAppNotificationServiceType | null;

  activityService: ActivityServiceType | null;

  commentService: CommentServiceType | null;

  openaiThreadDeletionCronService: unknown | null;

  openaiVectorStoreFileDeletionCronService: unknown | null;

  tokens: unknown | null;

  models: ModelsMapDependentOnCrowi;

  env: NodeJS.ProcessEnv;

  node_env: string;

  port: string | number;

  events: CrowiEvents;

  slack?: unknown;

  slackLegacy?: unknown;

  crowiDev?: CrowiDevType;

  constructor() {
    this.version = getGrowiVersion();

    this.publicDir = path.join(projectRoot, 'public') + sep;
    this.resourceDir = path.join(projectRoot, 'resource') + sep;
    this.localeDir = path.join(this.resourceDir, 'locales') + sep;
    this.viewsDir = path.resolve(__dirname, '../views') + sep;
    this.tmpDir = path.join(projectRoot, 'tmp') + sep;
    this.cacheDir = path.join(this.tmpDir, 'cache');

    this.accessTokenParser = accessTokenParser;
    this.loginRequiredFactory = loginRequiredFactory;

    this.config = {};
    this.s2sMessagingService = null;
    this.g2gTransferPusherService = null;
    this.g2gTransferReceiverService = null;
    this.mailService = null;
    this.pluginService = null;
    this.syncPageStatusService = null;
    this.inAppNotificationService = null;
    this.activityService = null;
    this.commentService = null;
    this.openaiThreadDeletionCronService = null;
    this.openaiVectorStoreFileDeletionCronService = null;

    this.tokens = null;

    this.models = {};

    this.env = process.env;
    this.node_env = this.env.NODE_ENV || 'development';

    this.port = this.env.PORT || 3000;

    this.events = {
      user: new UserEvent(this),
      page: new PageEvent(this),
      activity: new ActivityEvent(this),
      bookmark: new BookmarkEvent(this),
      tag: new TagEvent(this),
      admin: new AdminEvent(this),
    };
  }

  async init(): Promise<void> {
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
    await Promise.all([this.setUpApp(), this.setUpGrowiBridge()]);

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

    await this.setupCron();

    await normalizeData();
  }

  /**
   * Execute functions that should be run after the express server is ready.
   */
  async asyncAfterExpressServerReady(): Promise<void> {
    if (this.pageOperationService != null) {
      await this.pageOperationService.afterExpressServerReady();
    }
  }

  isPageId(pageId: unknown): boolean {
    if (!pageId) {
      return false;
    }

    if (typeof pageId === 'string' && pageId.match(/^[\da-f]{24}$/)) {
      return true;
    }

    return false;
  }

  setConfig(config: Record<string, unknown>): void {
    this.config = config;
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  getEnv(): NodeJS.ProcessEnv {
    return this.env;
  }

  async setupDatabase(): Promise<typeof mongoose> {
    mongoose.Promise = global.Promise;

    // mongoUri = mongodb://user:password@host/dbname
    const mongoUri = getMongoUri();

    return mongoose.connect(mongoUri, mongoOptions);
  }

  async setupSessionConfig(): Promise<void> {
    const session = require('express-session');
    const sessionMaxAge =
      this.configManager.getConfig('security:sessionMaxAge') || 2592000000; // default: 30days
    const redisUrl =
      this.env.REDISTOGO_URL ||
      this.env.REDIS_URI ||
      this.env.REDIS_URL ||
      null;
    const uid = require('uid-safe').sync;

    // generate pre-defined uid for healthcheck
    const healthcheckUid = uid(24);

    const sessionConfig: SessionConfig = {
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
      sessionConfig.store = MongoStore.create({
        client: mongoose.connection.getClient(),
      });
    }

    this.sessionConfig = sessionConfig;
  }

  async setupConfigManager(): Promise<void> {
    this.configManager = configManagerSingletonInstance;
    return this.configManager.loadConfigs();
  }

  async setupS2sMessagingService(): Promise<void> {
    const s2sMessagingService = require('../service/s2s-messaging')(this);
    if (s2sMessagingService != null) {
      s2sMessagingService.subscribe();
      this.configManager.setS2sMessagingService(s2sMessagingService);
      // add as a message handler
      s2sMessagingService.addMessageHandler(this.configManager);

      this.s2sMessagingService = s2sMessagingService;
    }
  }

  async setupSocketIoService(): Promise<void> {
    this.socketIoService = new SocketIoService(this);
  }

  async setupCron(): Promise<void> {
    instanciatePageBulkExportJobCronService(this);
    checkPageBulkExportJobInProgressCronService.startCron();

    instanciatePageBulkExportJobCleanUpCronService(this);
    // Dynamic import to get the initialized singleton instance
    const { pageBulkExportJobCleanUpCronService } = await import(
      '~/features/page-bulk-export/server/service/page-bulk-export-job-clean-up-cron'
    );
    if (pageBulkExportJobCleanUpCronService == null) {
      throw new Error('pageBulkExportJobCleanUpCronService is not initialized');
    }
    pageBulkExportJobCleanUpCronService.startCron();

    startOpenaiCronIfEnabled();
    startAccessTokenCron();
  }

  getSlack(): unknown {
    return this.slack;
  }

  getSlackLegacy(): unknown {
    return this.slackLegacy;
  }

  async setupPassport(): Promise<void> {
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
    } catch (err) {
      logger.error(err);
    }

    // add as a message handler
    if (this.s2sMessagingService != null) {
      this.s2sMessagingService.addMessageHandler(this.passportService);
    }
  }

  async setupSearcher(): Promise<void> {
    this.searchService = new SearchService(this);
  }

  async setupMailer(): Promise<void> {
    const MailService = require('~/server/service/mail').default;
    this.mailService = new MailService(this);

    // add as a message handler
    if (this.s2sMessagingService != null) {
      this.s2sMessagingService.addMessageHandler(this.mailService);
    }
  }

  async autoInstall(): Promise<void> {
    const isInstalled = this.configManager.getConfig('app:installed');
    const username = this.configManager.getConfig('autoInstall:adminUsername');

    if (isInstalled || username == null) {
      return;
    }

    logger.info('Start automatic installation');

    const firstAdminUserToSave = {
      username,
      name: this.configManager.getConfig('autoInstall:adminName') ?? username,
      email: this.configManager.getConfig('autoInstall:adminEmail') ?? '',
      password: this.configManager.getConfig('autoInstall:adminPassword') ?? '',
      admin: true,
    };
    const globalLang = this.configManager.getConfig('autoInstall:globalLang');
    const allowGuestMode = this.configManager.getConfig(
      'autoInstall:allowGuestMode',
    );
    const serverDateStr = this.configManager.getConfig(
      'autoInstall:serverDate',
    );
    const serverDate =
      serverDateStr != null ? new Date(serverDateStr) : undefined;

    const installerService = new InstallerService(this);

    try {
      await installerService.install(
        firstAdminUserToSave,
        globalLang ?? 'en_US',
        {
          allowGuestMode,
          serverDate,
        },
      );
    } catch (err) {
      logger.warn('Automatic installation failed.', err);
    }
  }

  getTokens(): unknown {
    return this.tokens;
  }

  async start(): Promise<http.Server> {
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

    const app =
      this.node_env === 'development'
        ? this.crowiDev!.setupServer(express)
        : express;

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
      logger.info(
        `[${this.node_env}] Express server is listening on port ${this.port}`,
      );
      if (this.node_env === 'development') {
        this.crowiDev!.setupExpressAfterListening(express);
      }
    });

    // setup Express Routes
    this.setupRoutesForPlugins();
    await this.setupRoutesAtLast();

    // setup Global Error Handlers
    this.setupGlobalErrorHandlers();

    // Execute this asynchronously after the express server is ready so it does not block the ongoing process
    this.asyncAfterExpressServerReady();

    return serverListening;
  }

  async buildServer(): Promise<void> {
    const env = this.node_env;
    const express: Express = require('express')();

    require('./express-init')(this, express);

    // use bunyan
    if (env === 'production') {
      const expressBunyanLogger = require('express-bunyan-logger');
      const bunyanLogger = loggerFactory('express');
      express.use(
        expressBunyanLogger({
          logger: bunyanLogger,
          excludes: ['*'],
        }),
      );
    }
    // use morgan
    else {
      const morgan = require('morgan');
      express.use(morgan('dev'));
    }

    this.express = express;
  }

  setupTerminus(server: http.Server): void {
    createTerminus(server, {
      signals: ['SIGINT', 'SIGTERM'],
      onSignal: async () => {
        logger.info('Server is starting cleanup');

        await mongoose.disconnect();
        return;
      },
      onShutdown: async () => {
        logger.info('Cleanup finished, server is shutting down');
      },
    });
  }

  setupRoutesForPlugins(): void {
    lsxRoutes(this, this.express);
    attachmentRoutes(this, this.express);
  }

  /**
   * setup Express Routes
   * !! this must be at last because it includes '/*' route !!
   */
  async setupRoutesAtLast(): Promise<void> {
    type RoutesSetup = (crowi: Crowi, app: Express) => void;
    // CommonJS modules are always wrapped in { default } when dynamically imported
    const { default: setupRoutes } = (await import('../routes')) as unknown as {
      default: RoutesSetup;
    };
    setupRoutes(this, this.express);
  }

  /**
   * setup global error handlers
   * !! this must be after the Routes setup !!
   */
  setupGlobalErrorHandlers(): void {
    this.express.use(httpErrorHandler);
  }

  /**
   * setup GlobalNotificationService
   */
  async setUpGlobalNotification(): Promise<void> {
    const { GlobalNotificationService } = await import(
      '../service/global-notification'
    );
    if (this.globalNotificationService == null) {
      this.globalNotificationService = new GlobalNotificationService(this);
    }
  }

  /**
   * setup UserNotificationService
   */
  async setUpUserNotification(): Promise<void> {
    if (this.userNotificationService == null) {
      this.userNotificationService = new UserNotificationService(this);
    }
  }

  /**
   * setup AclService
   */
  async setUpAcl(): Promise<void> {
    this.aclService = aclServiceSingletonInstance;
  }

  /**
   * setup CustomizeService
   */
  async setUpCustomize(): Promise<void> {
    const { CustomizeService } = await import('../service/customize');
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
  }

  /**
   * setup AppService
   */
  async setUpApp(): Promise<void> {
    if (this.appService == null) {
      this.appService = new AppService(this);

      // add as a message handler
      const isInstalled = this.configManager.getConfig('app:installed');
      if (this.s2sMessagingService != null && !isInstalled) {
        this.s2sMessagingService.addMessageHandler(this.appService);
      }
    }
  }

  /**
   * setup FileUploadService
   */
  async setUpFileUpload(isForceUpdate = false): Promise<void> {
    if (this.fileUploadService == null || isForceUpdate) {
      this.fileUploadService = getUploader(this);
    }
  }

  /**
   * setup FileUploaderSwitchService
   */
  async setUpFileUploaderSwitchService(): Promise<void> {
    const FileUploaderSwitchService = require('../service/file-uploader-switch');
    this.fileUploaderSwitchService = new FileUploaderSwitchService(this);
    // add as a message handler
    if (this.s2sMessagingService != null) {
      this.s2sMessagingService.addMessageHandler(
        this.fileUploaderSwitchService,
      );
    }
  }

  async setupGrowiInfoService(): Promise<void> {
    const { growiInfoService } = await import('../service/growi-info');
    this.growiInfoService = growiInfoService;
  }

  /**
   * setup AttachmentService
   */
  async setupAttachmentService(): Promise<void> {
    if (this.attachmentService == null) {
      this.attachmentService = new AttachmentService(this);
    }
  }

  async setupUserGroupService(): Promise<void> {
    if (this.userGroupService == null) {
      this.userGroupService = new UserGroupService(this);
      return this.userGroupService.init();
    }
  }

  async setUpGrowiBridge(): Promise<void> {
    if (this.growiBridgeService == null) {
      this.growiBridgeService = new GrowiBridgeService(this);
    }
  }

  async setupExport(): Promise<void> {
    instanciateExportService(this);
  }

  async setupImport(): Promise<void> {
    initializeImportService(this);
  }

  async setupGrowiPluginService(): Promise<void> {
    const growiPluginService = await import(
      '~/features/growi-plugin/server/services'
    ).then((mod) => mod.growiPluginService);

    // download plugin repositories, if document exists but there is no repository
    // TODO: Cannot download unless connected to the Internet at setup.
    await growiPluginService.downloadNotExistPluginRepositories();
  }

  async setupPageService(): Promise<void> {
    if (this.pageGrantService == null) {
      this.pageGrantService = new PageGrantService(this);
    }
    // initialize after pageGrantService since pageService uses pageGrantService in constructor
    if (this.pageService == null) {
      this.pageService = new PageService(this);
      await this.pageService.createTtlIndex();
    }
    this.pageOperationService = instanciatePageOperationService(this);
  }

  async setupInAppNotificationService(): Promise<void> {
    if (this.inAppNotificationService == null) {
      this.inAppNotificationService = new InAppNotificationService(this);
    }
  }

  async setupActivityService(): Promise<void> {
    if (this.activityService == null) {
      this.activityService = new ActivityService(this);
      await this.activityService.createTtlIndex();
    }
  }

  async setupCommentService(): Promise<void> {
    if (this.commentService == null) {
      this.commentService = new CommentService(this);
    }
  }

  async setupSyncPageStatusService(): Promise<void> {
    if (this.syncPageStatusService == null) {
      this.syncPageStatusService = new SyncPageStatusService(
        this,
        this.s2sMessagingService,
        this.socketIoService,
      );

      // add as a message handler
      if (this.s2sMessagingService != null) {
        this.s2sMessagingService.addMessageHandler(this.syncPageStatusService);
      }
    }
  }

  async setupSlackIntegrationService(): Promise<void> {
    if (this.slackIntegrationService == null) {
      this.slackIntegrationService = new SlackIntegrationService(this);
    }

    // add as a message handler
    if (this.s2sMessagingService != null) {
      this.s2sMessagingService.addMessageHandler(this.slackIntegrationService);
    }
  }

  async setupG2GTransferService(): Promise<void> {
    if (this.g2gTransferPusherService == null) {
      this.g2gTransferPusherService = new G2GTransferPusherService(this);
    }
    if (this.g2gTransferReceiverService == null) {
      this.g2gTransferReceiverService = new G2GTransferReceiverService(this);
    }
  }

  // execute after setupPassport
  setupExternalAccountService(): void {
    instanciateExternalAccountService(this.passportService);
  }

  // execute after setupPassport, s2sMessagingService, socketIoService
  setupExternalUserGroupSyncService(): void {
    this.ldapUserGroupSyncService = new LdapUserGroupSyncService(
      this.passportService,
      this.s2sMessagingService,
      this.socketIoService,
    );
    this.keycloakUserGroupSyncService = new KeycloakUserGroupSyncService(
      this.s2sMessagingService,
      this.socketIoService,
    );
  }

  setupOpenaiService(): void {
    initializeOpenaiService(this);
  }
}

export default Crowi;
