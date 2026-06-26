import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import loggerFactory from '~/utils/logger';

import type { IConfigManagerForApp } from '../config-manager';

const logger = loggerFactory('growi:service:mail');

// Time to wait for the TCP connection to the SMTP server to be established.
const SMTP_CONNECTION_TIMEOUT_MS = 10000;
// Time to wait for the SMTP greeting after the connection is established.
const SMTP_GREETING_TIMEOUT_MS = 10000;

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
  logger.debug('createSMTPClient called');

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
      // Fail fast on unreachable / misconfigured SMTP servers so the user gets
      // timely feedback instead of waiting for nodemailer's long default timeouts.
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
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

  logger.debug('mailer set up for SMTP');

  return client;
}
