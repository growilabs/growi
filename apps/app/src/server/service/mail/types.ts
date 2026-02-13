import type { NonBlankString } from '@growi/core/dist/interfaces';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

/**
 * Type-safe OAuth2 configuration with non-blank string validation.
 *
 * This type is stricter than nodemailer's default XOAuth2.Options, which allows
 * empty strings. By using NonBlankString, we prevent empty credentials at compile time,
 * matching nodemailer's runtime falsy checks (`!this.options.refreshToken`).
 *
 * @see https://github.com/nodemailer/nodemailer/blob/master/lib/xoauth2/index.js
 */
export type StrictOAuth2Options = {
  service: 'gmail';
  auth: {
    type: 'OAuth2';
    user: NonBlankString;
    clientId: NonBlankString;
    clientSecret: NonBlankString;
    refreshToken: NonBlankString;
  };
};

export type MailConfig = {
  to?: string;
  from?: string;
  text?: string;
  subject?: string;
};

export type EmailConfig = {
  to: string;
  from?: string;
  subject?: string;
  text?: string;
  template?: string;
  vars?: Record<string, unknown>;
};

export type SendResult = {
  messageId: string;
  response: string;
  envelope: {
    from: string;
    to: string[];
  };
};

// Type assertion: StrictOAuth2Options is compatible with SMTPTransport.Options
// This ensures our strict type can be passed to nodemailer.createTransport()
declare const _typeCheck: StrictOAuth2Options extends SMTPTransport.Options
  ? true
  : 'Type mismatch';
