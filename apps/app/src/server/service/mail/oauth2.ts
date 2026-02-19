import { toNonBlankStringOrUndefined } from '@growi/core/dist/interfaces';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import loggerFactory from '~/utils/logger';

import type { IConfigManagerForApp } from '../config-manager';
import type { StrictOAuth2Options } from './types';

const logger = loggerFactory('growi:service:mail');

/**
 * Creates a Gmail OAuth2 transport client with type-safe credentials.
 *
 * @param configManager - Configuration manager instance
 * @param option - Optional OAuth2 configuration (for testing)
 * @returns nodemailer Transporter instance, or null if credentials incomplete
 *
 * @remarks
 * Config keys required: mail:oauth2User, mail:oauth2ClientId,
 *                       mail:oauth2ClientSecret, mail:oauth2RefreshToken
 *
 * All credentials must be non-blank strings (length > 0 after trim).
 * Uses NonBlankString branded type to prevent empty string credentials at compile time.
 */
export function createOAuth2Client(
  configManager: IConfigManagerForApp,
  option?: SMTPTransport.Options,
): Transporter | null {
  if (!option) {
    const clientId = toNonBlankStringOrUndefined(
      configManager.getConfig('mail:oauth2ClientId'),
    );
    const clientSecret = toNonBlankStringOrUndefined(
      configManager.getConfig('mail:oauth2ClientSecret'),
    );
    const refreshToken = toNonBlankStringOrUndefined(
      configManager.getConfig('mail:oauth2RefreshToken'),
    );
    const user = toNonBlankStringOrUndefined(
      configManager.getConfig('mail:oauth2User'),
    );

    if (
      clientId === undefined ||
      clientSecret === undefined ||
      refreshToken === undefined ||
      user === undefined
    ) {
      logger.warn(
        'OAuth 2.0 credentials incomplete, skipping transport creation',
      );
      return null;
    }

    const strictOptions: StrictOAuth2Options = {
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user,
        clientId,
        clientSecret,
        refreshToken,
      },
    };

    // biome-ignore lint/style/noParameterAssign: constructing option from validated credentials
    option = strictOptions;
  }

  const client = nodemailer.createTransport(option);

  logger.debug('mailer set up for OAuth2', client);

  return client;
}
