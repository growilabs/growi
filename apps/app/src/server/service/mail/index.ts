/**
 * Mail service barrel export.
 *
 * Maintains backward compatibility with existing import pattern:
 * `import MailService from '~/server/service/mail'`
 */
export { default } from './mail';
export type {
  EmailConfig,
  MailConfig,
  SendResult,
  StrictOAuth2Options,
} from './types';
