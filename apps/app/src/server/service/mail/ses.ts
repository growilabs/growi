import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import ses from 'nodemailer-ses-transport';

import loggerFactory from '~/utils/logger';

import type { IConfigManagerForApp } from '../config-manager';

const logger = loggerFactory('growi:service:mail');

/**
 * Creates an AWS SES transport client for email sending.
 *
 * @param configManager - Configuration manager instance
 * @param option - Optional SES configuration (for testing)
 * @returns nodemailer Transporter instance, or null if credentials incomplete
 *
 * @remarks
 * Config keys required: mail:sesAccessKeyId, mail:sesSecretAccessKey
 */
export function createSESClient(
  configManager: IConfigManagerForApp,
  option?: { accessKeyId: string; secretAccessKey: string },
): Transporter | null {
  if (!option) {
    const accessKeyId = configManager.getConfig('mail:sesAccessKeyId');
    const secretAccessKey = configManager.getConfig('mail:sesSecretAccessKey');

    if (accessKeyId == null || secretAccessKey == null) {
      return null;
    }

    // biome-ignore lint/style/noParameterAssign: maintaining existing behavior
    option = {
      accessKeyId,
      secretAccessKey,
    };
  }

  const client = nodemailer.createTransport(ses(option));

  logger.debug('mailer set up for SES', client);

  return client;
}
