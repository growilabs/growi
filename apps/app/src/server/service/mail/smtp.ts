import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import loggerFactory from '~/utils/logger';

import type { IConfigManagerForApp } from '../config-manager';

const logger = loggerFactory('growi:service:mail');

/**
 * Creates an SMTP transport client for email sending.
 *
 * @param configManager - Configuration manager instance
 * @param option - Optional SMTP configuration (for testing)
 * @returns nodemailer Transporter instance, or null if credentials incomplete
 *
 * @remarks
 * Config keys required: mail:smtpHost, mail:smtpPort
 * Config keys optional: mail:smtpUser, mail:smtpPassword (auth)
 */
export function createSMTPClient(
  configManager: IConfigManagerForApp,
  option?: SMTPTransport.Options,
): Transporter | null {
  logger.debug('createSMTPClient option', option);

  let smtpOption: SMTPTransport.Options;

  if (option) {
    smtpOption = option;
  } else {
    const host = configManager.getConfig('mail:smtpHost');
    const port = configManager.getConfig('mail:smtpPort');

    if (host == null || port == null) {
      return null;
    }

    smtpOption = {
      host,
      port: Number(port),
    };

    if (configManager.getConfig('mail:smtpPassword')) {
      smtpOption.auth = {
        user: configManager.getConfig('mail:smtpUser'),
        pass: configManager.getConfig('mail:smtpPassword'),
      };
    }

    if (smtpOption.port === 465) {
      smtpOption.secure = true;
    }
  }

  smtpOption.tls = { rejectUnauthorized: false };

  const client = nodemailer.createTransport(smtpOption);

  logger.debug('mailer set up for SMTP', client);

  return client;
}
