import ejs from 'ejs';
import nodemailer from 'nodemailer';
import { promisify } from 'util';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
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

class MailService implements S2sMessageHandlable {
  appService!: any;

  configManager: IConfigManagerForApp;

  s2sMessagingService!: any;

  mailConfig: MailConfig = {};

  mailer: any = {};

  lastLoadedAt?: Date;

  /**
   * the flag whether mailer is set up successfully
   */
  isMailerSetup = false;

  constructor(crowi: Crowi) {
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
      option = {
        // eslint-disable-line no-param-reassign
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
        // eslint-disable-line no-param-reassign
        accessKeyId,
        secretAccessKey,
      };
    }

    const ses = require('nodemailer-ses-transport');
    const client = nodemailer.createTransport(ses(option));

    logger.debug('mailer set up for SES', client);

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

module.exports = MailService;
