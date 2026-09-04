/**
 * Unit test for the shared password-reset mail flow.
 *
 * Contract under test (observable behavior, not mechanism):
 *  - createAndSendPasswordResetOrder() issues a PasswordResetOrder for the given
 *    address and mails THAT address a one-time link built from the issued token
 *    and the configured site URL, with the expiry rendered in the app timezone;
 *  - it returns the issued order, and rejects (does not swallow) when the mail
 *    cannot be sent — the downgrade-prep script relies on that rejection to keep
 *    a user's passwordHash intact;
 *  - sendPasswordResetTemplateEmail() renders only allow-listed templates: an
 *    unexpected name is rejected WITHOUT sending anything (path-traversal guard,
 *    since the name becomes a path segment).
 */
import { addHours } from 'date-fns/addHours';
import { format } from 'date-fns/format';
import { mock } from 'vitest-mock-extended';

import type Crowi from '../../crowi';

const createPasswordResetOrder = vi.fn();
vi.mock('../../models/password-reset-order', () => ({
  default: { createPasswordResetOrder },
}));

const getConfig = vi.fn();
vi.mock('../config-manager', () => ({ configManager: { getConfig } }));

const getSiteUrl = vi.fn();
vi.mock('../growi-info', () => ({ growiInfoService: { getSiteUrl } }));

const LOCALE_DIR = '/growi/resource/locales/';
const APP_TITLE = 'My GROWI';
// getTzoffset() returns minutes; -540 is the default GROWI timezone (UTC+9).
const TZOFFSET_MINUTES_UTC_PLUS_9 = -540;

const EMAIL = 'someone@example.com';
const TOKEN = 'one-time-token-abc';
const ORDER_EXPIRES_AT = new Date('2026-08-06T00:30:00.000Z');

const buildCrowi = (send: ReturnType<typeof vi.fn>) =>
  mock<Crowi>({
    localeDir: LOCALE_DIR,
    appService: {
      getAppTitle: () => APP_TITLE,
      getTzoffset: () => TZOFFSET_MINUTES_UTC_PLUS_9,
    },
    mailService: { send },
  });

describe('shared password-reset mail flow', () => {
  beforeEach(() => {
    getConfig.mockReturnValue('en_US');
    getSiteUrl.mockReturnValue('https://wiki.example.com/');
    createPasswordResetOrder.mockResolvedValue({
      token: TOKEN,
      email: EMAIL,
      expiredAt: ORDER_EXPIRES_AT,
    });
  });

  describe('createAndSendPasswordResetOrder', () => {
    it('mails the one-time reset link for a freshly issued order to that address', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const crowi = buildCrowi(send);
      const { createAndSendPasswordResetOrder } = await import(
        './send-password-reset-email'
      );

      const order = await createAndSendPasswordResetOrder(crowi, EMAIL);

      expect(createPasswordResetOrder).toHaveBeenCalledWith(EMAIL);
      expect(order.token).toBe(TOKEN);

      expect(send).toHaveBeenCalledTimes(1);
      const sent = send.mock.calls[0][0];
      expect(sent.to).toBe(EMAIL);
      expect(sent.template).toBe(
        `${LOCALE_DIR}en_US/notifications/passwordReset.ejs`,
      );
      expect(sent.vars).toMatchObject({
        appTitle: APP_TITLE,
        email: EMAIL,
        // absolute link on the configured site URL, carrying the issued token
        url: `https://wiki.example.com/forgot-password/${TOKEN}`,
      });
      // The expiry is shown in the app's timezone (UTC+9), not raw UTC. Rendered
      // with `format` so the assertion does not depend on the runner's own TZ.
      expect(sent.vars.expiredAt).toBe(
        format(addHours(ORDER_EXPIRES_AT, 9), 'yyyy/MM/dd HH:mm'),
      );
    });

    it('rejects when the mail cannot be sent, so callers can treat the send as a precondition', async () => {
      const send = vi.fn().mockRejectedValue(new Error('SMTP is down'));
      const crowi = buildCrowi(send);
      const { createAndSendPasswordResetOrder } = await import(
        './send-password-reset-email'
      );

      await expect(
        createAndSendPasswordResetOrder(crowi, EMAIL),
      ).rejects.toThrow('SMTP is down');
    });

    it('rejects without sending when the mail service is not set up', async () => {
      const crowi = mock<Crowi>({
        localeDir: LOCALE_DIR,
        appService: {
          getAppTitle: () => APP_TITLE,
          getTzoffset: () => TZOFFSET_MINUTES_UTC_PLUS_9,
        },
        mailService: null,
      });
      const { createAndSendPasswordResetOrder } = await import(
        './send-password-reset-email'
      );

      await expect(
        createAndSendPasswordResetOrder(crowi, EMAIL),
      ).rejects.toThrow(/mailService/);
    });
  });

  describe('sendPasswordResetTemplateEmail', () => {
    it('renders the localized template for an allow-listed name', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const crowi = buildCrowi(send);
      const { sendPasswordResetTemplateEmail } = await import(
        './send-password-reset-email'
      );

      await sendPasswordResetTemplateEmail(crowi, {
        templateName: 'passwordResetSuccessful',
        locale: 'ja_JP',
        email: EMAIL,
      });

      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].template).toBe(
        `${LOCALE_DIR}ja_JP/notifications/passwordResetSuccessful.ejs`,
      );
    });

    it('refuses a template name outside the allowlist and sends nothing', async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const crowi = buildCrowi(send);
      const { sendPasswordResetTemplateEmail } = await import(
        './send-password-reset-email'
      );

      await expect(
        sendPasswordResetTemplateEmail(crowi, {
          // Simulates a JS caller (the apiv3 route is plain JS) passing a name
          // that would otherwise be interpolated into the template path.
          templateName: '../../../../etc/passwd' as 'passwordReset',
          locale: 'en_US',
          email: EMAIL,
        }),
      ).rejects.toThrow(/Invalid template name/);

      expect(send).not.toHaveBeenCalled();
    });
  });
});
