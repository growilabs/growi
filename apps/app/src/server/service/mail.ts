import ejs from 'ejs';
import nodemailer from 'nodemailer';
import { promisify } from 'util';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { FailedEmail } from '../models/failed-email';
import S2sMessage from '../models/vo/s2s-message';
import type { IConfigManagerForApp } from './config-manager';
import type { S2sMessageHandlable } from './s2s-messaging/handlable';

const logger = loggerFactory('growi:service:mail');

type MailConfig = {
  to?: string;
  from?: string;
  text?: string;
  subject?: string;
};

type EmailConfig = {
  to: string;
  from?: string;
  subject?: string;
  text?: string;
  template?: string;
  vars?: Record<string, unknown>;
};

type SendResult = {
  messageId: string;
  response: string;
  envelope: {
    from: string;
    to: string[];
  };
};

class MailService implements S2sMessageHandlable {
  appService!: any;

  configManager: IConfigManagerForApp;

  s2sMessagingService!: any;

  crowi: Crowi;

  mailConfig: MailConfig = {};

  mailer: any = {};

  lastLoadedAt?: Date;

  /**
   * the flag whether mailer is set up successfully
   */
  isMailerSetup = false;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.appService = crowi.appService;
    this.configManager = crowi.configManager;
    this.s2sMessagingService = crowi.s2sMessagingService;

    this.initialize();
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage) {
    const { eventName, updatedAt } = s2sMessage;
    if (eventName !== 'mailServiceUpdated' || updatedAt == null) {
      return false;
    }

    return (
      this.lastLoadedAt == null ||
      this.lastLoadedAt < new Date(s2sMessage.updatedAt)
    );
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(s2sMessage) {
    const { configManager } = this;

    logger.info('Initialize mail settings by pubsub notification');
    await configManager.loadConfigs();
    this.initialize();
  }

  async publishUpdatedMessage() {
    const { s2sMessagingService } = this;

    if (s2sMessagingService != null) {
      const s2sMessage = new S2sMessage('mailServiceUpdated', {
        updatedAt: new Date(),
      });

      try {
        await s2sMessagingService.publish(s2sMessage);
      } catch (e) {
        logger.error(
          'Failed to publish update message with S2sMessagingService: ',
          e.message,
        );
      }
    }
  }

  initialize() {
    const { appService, configManager } = this;

    this.isMailerSetup = false;

    if (!configManager.getConfig('mail:from')) {
      this.mailer = null;
      return;
    }

    const transmissionMethod = configManager.getConfig(
      'mail:transmissionMethod',
    );

    if (transmissionMethod === 'smtp') {
      this.mailer = this.createSMTPClient();
    } else if (transmissionMethod === 'ses') {
      this.mailer = this.createSESClient();
    } else if (transmissionMethod === 'oauth2') {
      this.mailer = this.createOAuth2Client();
    } else {
      this.mailer = null;
    }

    if (this.mailer != null) {
      this.isMailerSetup = true;
    }

    this.mailConfig.from = configManager.getConfig('mail:from');
    this.mailConfig.subject = `${appService.getAppTitle()}からのメール`;

    logger.debug('mailer initialized');
  }

  createSMTPClient(option?) {
    const { configManager } = this;

    logger.debug('createSMTPClient option', option);
    if (!option) {
      const host = configManager.getConfig('mail:smtpHost');
      const port = configManager.getConfig('mail:smtpPort');

      if (host == null || port == null) {
        return null;
      }

      // biome-ignore lint/style/noParameterAssign: ignore
      option = {
        host,
        port,
      };

      if (configManager.getConfig('mail:smtpPassword')) {
        option.auth = {
          user: configManager.getConfig('mail:smtpUser'),
          pass: configManager.getConfig('mail:smtpPassword'),
        };
      }
      if (option.port === 465) {
        option.secure = true;
      }
    }
    option.tls = { rejectUnauthorized: false };

    const client = nodemailer.createTransport(option);

    logger.debug('mailer set up for SMTP', client);

    return client;
  }

  createSESClient(option?) {
    const { configManager } = this;

    if (!option) {
      const accessKeyId = configManager.getConfig('mail:sesAccessKeyId');
      const secretAccessKey = configManager.getConfig(
        'mail:sesSecretAccessKey',
      );
      if (accessKeyId == null || secretAccessKey == null) {
        return null;
      }
      option = {
        accessKeyId,
        secretAccessKey,
      };
    }

    const ses = require('nodemailer-ses-transport');
    const client = nodemailer.createTransport(ses(option));

    logger.debug('mailer set up for SES', client);

    return client;
  }

  createOAuth2Client(option?) {
    const { configManager } = this;

    if (!option) {
      const clientId = configManager.getConfig('mail:oauth2ClientId');
      const clientSecret = configManager.getConfig('mail:oauth2ClientSecret');
      const refreshToken = configManager.getConfig('mail:oauth2RefreshToken');
      const user = configManager.getConfig('mail:oauth2User');

      if (
        clientId == null ||
        clientSecret == null ||
        refreshToken == null ||
        user == null
      ) {
        return null;
      }

      option = {
        // eslint-disable-line no-param-reassign
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user,
          clientId,
          clientSecret,
          refreshToken,
        },
      };
    }

    const client = nodemailer.createTransport(option);

    logger.debug('mailer set up for OAuth2', client);

    return client;
  }

  setupMailConfig(overrideConfig) {
    const c = overrideConfig;

    let mc: MailConfig = {};
    mc = this.mailConfig;

    mc.to = c.to;
    mc.from = c.from || this.mailConfig.from;
    mc.text = c.text;
    mc.subject = c.subject || this.mailConfig.subject;

    return mc;
  }

  maskCredential(credential: string): string {
    if (!credential || credential.length <= 4) {
      return '****';
    }
    return `****${credential.slice(-4)}`;
  }

  async exponentialBackoff(attempt: number): Promise<void> {
    const backoffIntervals = [1000, 2000, 4000];
    const delay = backoffIntervals[attempt - 1] || 4000;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async sendWithRetry(
    config: EmailConfig,
    maxRetries = 3,
  ): Promise<SendResult> {
    const { configManager } = this;
    const clientId = configManager.getConfig('mail:oauth2ClientId') || '';
    const maskedClientId = this.maskCredential(clientId);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.mailer.sendMail(config);
        logger.info('OAuth 2.0 email sent successfully', {
          messageId: result.messageId,
          recipient: config.to,
          attempt,
          clientId: maskedClientId,
          tag: 'oauth2_email_success',
        });
        return result;
      } catch (error: unknown) {
        const err = error as Error & { code?: string };

        // Determine monitoring tag based on error code
        let monitoringTag = 'oauth2_email_error';
        if (err.code === 'invalid_grant' || err.code === 'invalid_client') {
          monitoringTag = 'oauth2_token_refresh_failure';
        } else if (err.code) {
          monitoringTag = 'gmail_api_error';
        }

        logger.error(
          `OAuth 2.0 email send failed (attempt ${attempt}/${maxRetries})`,
          {
            error: err.message,
            code: err.code,
            user: config.from,
            recipient: config.to,
            clientId: maskedClientId,
            attemptNumber: attempt,
            timestamp: new Date().toISOString(),
            tag: monitoringTag,
          },
        );

        if (attempt === maxRetries) {
          await this.storeFailedEmail(config, err);
          throw new Error(
            `OAuth 2.0 email send failed after ${maxRetries} attempts`,
          );
        }

        await this.exponentialBackoff(attempt);
      }
    }

    // This should never be reached, but TypeScript needs a return statement
    throw new Error(
      'Unexpected: sendWithRetry loop completed without returning',
    );
  }

  async storeFailedEmail(
    config: EmailConfig,
    error: Error & { code?: string },
  ): Promise<void> {
    try {
      const failedEmail = {
        emailConfig: config,
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
        transmissionMethod: 'oauth2' as const,
        attempts: 3,
        lastAttemptAt: new Date(),
        createdAt: new Date(),
      };

      await FailedEmail.create(failedEmail);

      logger.error('Failed email stored for manual review', {
        recipient: config.to,
        errorMessage: error.message,
        errorCode: error.code,
      });
    } catch (err: unknown) {
      const storeError = err as Error;
      logger.error('Failed to store failed email', {
        error: storeError.message,
        originalError: error.message,
      });
      throw new Error(`Failed to store failed email: ${storeError.message}`);
    }
  }

  async send(config) {
    if (this.mailer == null) {
      throw new Error(
        'Mailer is not completed to set up. Please set up SMTP or AWS setting.',
      );
    }

    const renderFilePromisified = promisify<string, ejs.Data, string>(
      ejs.renderFile,
    );

    const templateVars = config.vars || {};
    const output = await renderFilePromisified(config.template, templateVars);

    config.text = output;
    return this.mailer.sendMail(this.setupMailConfig(config));
  }
}

export default MailService;
