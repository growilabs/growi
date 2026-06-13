/**
 * Mail service barrel export.
 *
 * Maintains backward compatibility with existing import pattern:
 * `import MailService from '~/server/service/mail'`
 */
export { default } from './mail.js';
export type {
  EmailConfig,
  MailConfig,
  SendResult,
  StrictOAuth2Options,
} from './types.js';
