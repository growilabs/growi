import { format } from 'date-fns/format';
import { subSeconds } from 'date-fns/subSeconds';

import type Crowi from '../../crowi';
import type { PasswordResetOrderDocument } from '../../models/password-reset-order';
import PasswordResetOrder from '../../models/password-reset-order';
import { resolveLocalePath } from '../../util/safe-path-utils';
import { configManager } from '../config-manager';
import { growiInfoService } from '../growi-info';

/**
 * Password-reset notification templates that may be rendered by this module.
 * The allowlist is a path-traversal guard: `templateName` reaches
 * `resolveLocalePath` as a path segment, so it must never be attacker-influenced.
 */
const ALLOWED_TEMPLATE_NAMES = [
  'passwordReset',
  'passwordResetSuccessful',
] as const;

export type PasswordResetTemplateName = (typeof ALLOWED_TEMPLATE_NAMES)[number];

export interface PasswordResetTemplateMailArgs {
  templateName: PasswordResetTemplateName;
  /** UI locale used to pick the localized .ejs template. */
  locale: string;
  email: string;
  /** One-time reset URL. Only the `passwordReset` template renders it. */
  url?: string;
  /** Pre-formatted, timezone-adjusted expiry shown in the mail body. */
  expiredAt?: string;
}

/**
 * Render one of the password-reset notification templates and send it.
 *
 * Shared by the apiv3 forgot-password route (both the request and the
 * "reset succeeded" mail) and the password-hash downgrade-prep admin script, so
 * that the template allowlist, subject and template vars cannot drift apart
 * between them.
 */
export const sendPasswordResetTemplateEmail = async (
  crowi: Crowi,
  args: PasswordResetTemplateMailArgs,
): Promise<void> => {
  const { templateName, locale, email, url, expiredAt } = args;

  // Runtime check, not just a type: the apiv3 route is plain JS.
  if (!(ALLOWED_TEMPLATE_NAMES as readonly string[]).includes(templateName)) {
    throw new Error(`Invalid template name: ${templateName}`);
  }

  const { appService, mailService } = crowi;
  if (mailService == null) {
    throw new Error('mailService is not set up');
  }

  const templatePath = resolveLocalePath(
    locale,
    crowi.localeDir,
    `notifications/${templateName}.ejs`,
  );

  await mailService.send({
    to: email,
    subject: '[GROWI] Password Reset',
    template: templatePath,
    vars: {
      appTitle: appService.getAppTitle(),
      email,
      url,
      expiredAt,
    },
  });
};

/**
 * Issue a `PasswordResetOrder` for `email` and send the one-time reset link to it.
 *
 * This is the whole "user forgot / lost their password" mail flow minus the
 * caller-specific policy: the apiv3 route decides whether the address belongs to
 * an ACTIVE user before calling this, and the downgrade-prep script decides
 * which users need a reset before a downgrade. Everything below that decision —
 * order creation, one-time URL, timezone-adjusted expiry, template vars — is
 * identical for both and lives here.
 *
 * Rejects when the mail cannot be sent, so a caller can treat "the user has been
 * notified" as a precondition for destructive follow-up work.
 *
 * NOTE: the returned order expires quickly (see `expiredAt` in
 * models/password-reset-order). A caller sending in bulk must expect recipients
 * to need a fresh `/forgot-password` request.
 */
export const createAndSendPasswordResetOrder = async (
  crowi: Crowi,
  email: string,
): Promise<PasswordResetOrderDocument> => {
  const locale = configManager.getConfig('app:globalLang');
  const appUrl = growiInfoService.getSiteUrl();

  const passwordResetOrder =
    await PasswordResetOrder.createPasswordResetOrder(email);

  const oneTimeUrl = new URL(
    `/forgot-password/${passwordResetOrder.token}`,
    appUrl,
  ).href;

  const grwTzoffsetSec = crowi.appService.getTzoffset() * 60;
  const formattedExpiredAt = format(
    subSeconds(passwordResetOrder.expiredAt, grwTzoffsetSec),
    'yyyy/MM/dd HH:mm',
  );

  await sendPasswordResetTemplateEmail(crowi, {
    templateName: 'passwordReset',
    locale,
    email,
    url: oneTimeUrl,
    expiredAt: formattedExpiredAt,
  });

  return passwordResetOrder;
};
