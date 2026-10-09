import { PageGrant } from '@growi/core';

import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';

import {
  buildNotificationContent,
  type NotificationContentInput,
} from './notification-content';

const PUBLIC_PAGE = { path: '/public-page', grant: PageGrant.GRANT_PUBLIC };
const RESTRICTED_PAGE = {
  path: '/restricted-page',
  grant: PageGrant.GRANT_OWNER,
};

const baseInput = (
  overrides: Partial<NotificationContentInput>,
): NotificationContentInput => ({
  event: GlobalNotificationSettingEvent.PAGE_CREATE,
  page: { ...PUBLIC_PAGE, body: 'hello world' },
  pageUrl: 'https://growi.example.com/abc123',
  triggeredByUsername: 'alice',
  ...overrides,
});

describe('buildNotificationContent', () => {
  describe('pageCreate', () => {
    it('embeds the full body when the page is publicly readable', () => {
      const result = buildNotificationContent(
        baseInput({
          page: { ...PUBLIC_PAGE, body: 'a short new page body' },
        }),
      );

      expect(result.containsRestrictedPage).toBe(false);
      expect(result.markdown).toContain('a short new page body');
      expect(result.markdown).toContain('/public-page');
      expect(result.markdown).toContain('alice');
    });

    it('truncates a body over 2000 characters, matching Gen 1 convention', () => {
      const longBody = 'x'.repeat(2500);
      const result = buildNotificationContent(
        baseInput({ page: { ...PUBLIC_PAGE, body: longBody } }),
      );

      expect(result.markdown).toContain(`${'x'.repeat(2000)}...`);
      expect(result.markdown).not.toContain('x'.repeat(2001));
    });

    it('drops the body entirely when the page is not publicly readable', () => {
      const result = buildNotificationContent(
        baseInput({
          page: { ...RESTRICTED_PAGE, body: 'this must never leak' },
        }),
      );

      expect(result.containsRestrictedPage).toBe(true);
      expect(result.markdown).not.toContain('this must never leak');
      // The path/link itself is not body content -- Requirement 2.3 only
      // withholds the page body, not the notification's existence/link.
      expect(result.markdown).toContain('/restricted-page');
    });
  });

  describe('pageEdit', () => {
    it('embeds a diff (not a full re-embed) built the same way as Gen 1', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_EDIT,
          page: {
            ...PUBLIC_PAGE,
            body: 'line one\nline two\nline three\n',
          },
          previousBody: 'line one\nline three\n',
        }),
      );

      expect(result.containsRestrictedPage).toBe(false);
      // Gen 1's `prepareAttachmentTextForUpdate` (server/util/slack.js) marks
      // an added line with the `:lower_left_fountain_pen:` suffix.
      expect(result.markdown).toContain('line two');
      expect(result.markdown).toContain(':lower_left_fountain_pen:');
      // The full new body must NOT be embedded wholesale -- only the diff.
      expect(result.markdown).not.toContain('line one\nline two\nline three\n');
    });

    it('produces no diff text when there is no previous revision (matches Gen 1)', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_EDIT,
          page: { ...PUBLIC_PAGE, body: 'brand new content' },
          previousBody: undefined,
        }),
      );

      expect(result.markdown).not.toContain('brand new content');
    });

    it('drops the diff entirely when the page is not publicly readable', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_EDIT,
          page: { ...RESTRICTED_PAGE, body: 'secret line two\n' },
          previousBody: 'secret line one\n',
        }),
      );

      expect(result.containsRestrictedPage).toBe(true);
      expect(result.markdown).not.toContain('secret');
    });
  });

  describe('pageDelete', () => {
    it('produces a header-only notification, restricted flag reflects the deleted page grant', () => {
      const publicResult = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_DELETE,
          page: { ...PUBLIC_PAGE, body: 'irrelevant body' },
        }),
      );
      expect(publicResult.containsRestrictedPage).toBe(false);
      expect(publicResult.markdown).not.toContain('irrelevant body');
      expect(publicResult.markdown).toContain('/public-page');

      const restrictedResult = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_DELETE,
          page: { ...RESTRICTED_PAGE, body: 'irrelevant body' },
        }),
      );
      expect(restrictedResult.containsRestrictedPage).toBe(true);
    });
  });

  describe('pageMove', () => {
    it('mentions both the old and new path, with no body content', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_MOVE,
          page: { ...PUBLIC_PAGE, body: 'irrelevant body' },
          oldPath: '/old-location',
        }),
      );

      expect(result.markdown).toContain('/old-location');
      expect(result.markdown).toContain('/public-page');
      expect(result.markdown).not.toContain('irrelevant body');
    });
  });

  describe('pageLike', () => {
    it('produces a header-only notification with no body content', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.PAGE_LIKE,
          page: { ...PUBLIC_PAGE, body: 'irrelevant body' },
        }),
      );

      expect(result.containsRestrictedPage).toBe(false);
      expect(result.markdown).not.toContain('irrelevant body');
      expect(result.markdown).toContain('alice');
    });
  });

  describe('comment', () => {
    it('embeds the comment body when the page is publicly readable', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.COMMENT,
          page: { ...PUBLIC_PAGE, body: 'irrelevant page body' },
          commentBody: 'nice page!',
        }),
      );

      expect(result.containsRestrictedPage).toBe(false);
      expect(result.markdown).toContain('nice page!');
      expect(result.markdown).not.toContain('irrelevant page body');
    });

    it('drops the comment body when the page is not publicly readable', () => {
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.COMMENT,
          page: { ...RESTRICTED_PAGE, body: 'irrelevant page body' },
          commentBody: 'this comment must never leak',
        }),
      );

      expect(result.containsRestrictedPage).toBe(true);
      expect(result.markdown).not.toContain('this comment must never leak');
    });

    it('truncates a comment body over 2000 characters, matching Gen 1 convention', () => {
      const longComment = 'y'.repeat(2500);
      const result = buildNotificationContent(
        baseInput({
          event: GlobalNotificationSettingEvent.COMMENT,
          page: { ...PUBLIC_PAGE, body: '' },
          commentBody: longComment,
        }),
      );

      expect(result.markdown).toContain(`${'y'.repeat(2000)}...`);
      expect(result.markdown).not.toContain('y'.repeat(2001));
    });
  });
});
