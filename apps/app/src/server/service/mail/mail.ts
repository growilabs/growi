import ejs from 'ejs';
import { promisify } from 'util';

import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { FailedEmail } from '../../models/failed-email';
import S2sMessage from '../../models/vo/s2s-message';
import type { IConfigManagerForApp } from '../config-manager';
import type { S2sMessageHandlable } from '../s2s-messaging/handlable';
import { createOAuth2Client } from './oauth2';
import { createSESClient } from './ses';
import { createSMTPClient } from './smtp';
import type { EmailConfig, MailConfig, SendResult } from './types';

const logger = loggerFactory('growi:service:mail');

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
      this.mailer = createSMTPClient(configManager);
    } else if (transmissionMethod === 'ses') {
      this.mailer = createSESClient(configManager);
    } else if (transmissionMethod === 'oauth2') {
      this.mailer = createOAuth2Client(configManager);
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
          from: config.from,
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
        'Mailer is not completed to set up. Please set up SMTP, SES, or OAuth 2.0 setting.',
      );
    }

    const renderFilePromisified = promisify<string, ejs.Data, string>(
      ejs.renderFile,
    );

    const templateVars = config.vars || {};
    const output = await renderFilePromisified(config.template, templateVars);

    config.text = output;

    const mailConfig = this.setupMailConfig(config);
    const transmissionMethod = this.configManager.getConfig(
      'mail:transmissionMethod',
    );

    // Use sendWithRetry for OAuth 2.0 to handle token refresh failures with exponential backoff
    if (transmissionMethod === 'oauth2') {
      logger.debug('Sending email via OAuth2 with config:', {
        from: mailConfig.from,
        to: mailConfig.to,
        subject: mailConfig.subject,
      });
      return this.sendWithRetry(mailConfig as EmailConfig);
    }

    return this.mailer.sendMail(mailConfig);
  }
}

export default MailService;
