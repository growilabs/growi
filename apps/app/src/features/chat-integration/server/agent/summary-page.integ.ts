// The summary page against GROWI's real page creation (real `pageService.create`,
// real `Page` documents): what the page looks like afterwards is the contract,
// so every assertion reads the page back from the database.
//
// Requirements: 5.9, 5.10, 5.11, 5.18.

import { type IUser, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';

import type { CommandAuditContext } from '../command/command-endpoint';
import { createSummaryPage } from './summary-page';

const USERNAME_PREFIX = 'chat-summary-';
const NOW = new Date(2026, 10, 16, 9, 30);
const DATE_SEGMENT = '2026-11-16';

const auditContext = (): CommandAuditContext => ({
  ip: '10.0.0.155',
  endpoint:
    '/_api/v3/chat-integration/peer/command chat-channel=slack:C0SUMMARY (summary)',
  requestArrivedAt: new Date(),
});

describe('createSummaryPage (real page creation)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let seq = 0;

  const createGrowiUser = (): Promise<HydratedDocument<IUser>> => {
    seq += 1;
    return crowi.models.User.create({
      name: `Chat Summary ${seq}`,
      username: `${USERNAME_PREFIX}${Date.now()}-${seq}`,
      email: `${USERNAME_PREFIX}${seq}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
  };

  const readBack = (pageId: string) => Page.findById(pageId).lean();

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);
    Page = mongoose.model<PageDocument, PageModel>('Page');

    // Fire-and-forget page-create work whose async DB writes would outlive
    // the test; none of it touches what is asserted below.
    vi.spyOn(crowi.pageService, 'createSubOperation').mockResolvedValue();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('without a requested path (own memo)', () => {
    it('creates a WIP page with a body that carries no auto-delete expiry', async () => {
      const user = await createGrowiUser();

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: null,
        title: 'Weekly sync',
        body: '# Summary\n\n- decided X',
        now: NOW,
        auditContext: auditContext(),
      });

      expect(result.kind).toBe('created');
      if (result.kind !== 'created') return;
      const saved = await readBack(result.pageId);
      expect(saved?.wip).toBe(true);
      expect(saved?.wipExpiredAt).toBeUndefined();
    });

    it('creates the page as the user, at the dated memo path, visible to the user only', async () => {
      const user = await createGrowiUser();
      const otherUser = await createGrowiUser();

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: null,
        title: 'Release / retro',
        body: 'summary body',
        now: NOW,
        auditContext: auditContext(),
      });

      const expectedPath = `/user/${user.username}/memo/${DATE_SEGMENT} Release retro`;
      expect(result).toEqual({
        kind: 'created',
        pageId: expect.any(String),
        path: expectedPath,
      });
      if (result.kind !== 'created') return;
      const saved = await readBack(result.pageId);
      expect(saved?.path).toBe(expectedPath);
      expect(saved?.creator?.toString()).toBe(user._id.toString());
      expect(saved?.grant).toBe(PageGrant.GRANT_OWNER);
      expect(await Page.isAccessiblePageByViewer(result.pageId, user)).toBe(
        true,
      );
      expect(
        await Page.isAccessiblePageByViewer(result.pageId, otherUser),
      ).toBe(false);
    });

    it('reports a path conflict when the same title is summarised twice on one day', async () => {
      const user = await createGrowiUser();
      const summarise = () =>
        createSummaryPage({
          crowi,
          user,
          requestedPath: null,
          title: 'Daily',
          body: 'body',
          now: NOW,
          auditContext: auditContext(),
        });

      expect((await summarise()).kind).toBe('created');
      expect(await summarise()).toEqual({
        kind: 'failed',
        reason: 'path-conflict',
      });
    });
  });

  describe('without a requested path, when user pages are disabled', () => {
    beforeAll(async () => {
      await crowi.configManager.updateConfig('security:disableUserPages', true);
    });

    afterAll(async () => {
      await crowi.configManager.updateConfigs(
        { 'security:disableUserPages': undefined },
        { removeIfUndefined: true },
      );
    });

    it('creates the page in /memo/<username>/, where the user can open it and others cannot', async () => {
      const user = await createGrowiUser();
      const otherUser = await createGrowiUser();

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: null,
        title: 'Weekly sync',
        body: 'summary body',
        now: NOW,
        auditContext: auditContext(),
      });

      const expectedPath = `/memo/${user.username}/${DATE_SEGMENT} Weekly sync`;
      expect(result).toMatchObject({ kind: 'created', path: expectedPath });
      if (result.kind !== 'created') return;
      const saved = await readBack(result.pageId);
      expect(saved?.creator?.toString()).toBe(user._id.toString());
      expect(saved?.grant).toBe(PageGrant.GRANT_OWNER);
      expect(saved?.wip).toBe(true);
      expect(saved?.wipExpiredAt).toBeUndefined();
      expect(await Page.isAccessiblePageByViewer(result.pageId, user)).toBe(
        true,
      );
      expect(
        await Page.isAccessiblePageByViewer(result.pageId, otherUser),
      ).toBe(false);
    });
  });

  describe('with a requested path', () => {
    const createOwnerOnlyPage = async (
      path: string,
      owner: HydratedDocument<IUser>,
    ) => {
      const root = await Page.findOne({ path: '/' });
      return Page.create({
        path,
        parent: root?._id,
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [owner._id],
        creator: owner._id,
      });
    };

    it('creates a WIP page without expiry at that path, with the grant create-page would give', async () => {
      const user = await createGrowiUser();
      const parentPath = `/chat-summary-parent-${Date.now()}-${seq}`;
      await createOwnerOnlyPage(parentPath, user);

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: `${parentPath.slice(1)}/notes/`,
        title: 'ignored',
        body: 'summary body',
        now: NOW,
        auditContext: auditContext(),
      });

      expect(result).toMatchObject({
        kind: 'created',
        path: `${parentPath}/notes`,
      });
      if (result.kind !== 'created') return;
      const saved = await readBack(result.pageId);
      expect(saved?.creator?.toString()).toBe(user._id.toString());
      expect(saved?.wip).toBe(true);
      expect(saved?.wipExpiredAt).toBeUndefined();
      // Inherited from the closest ancestor, as for create-page.
      expect(saved?.grant).toBe(PageGrant.GRANT_OWNER);
    });

    it('reports a path conflict and leaves an existing page alone', async () => {
      const user = await createGrowiUser();
      const path = `/chat-summary-existing-${Date.now()}-${seq}`;
      const existing = await createOwnerOnlyPage(path, user);

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: path,
        title: 'ignored',
        body: 'summary body',
        now: NOW,
        auditContext: auditContext(),
      });

      expect(result).toEqual({ kind: 'failed', reason: 'path-conflict' });
      const after = await readBack(existing._id.toString());
      expect(after?.wip).toBeFalsy();
      expect(await Page.countDocuments({ path })).toBe(1);
    });

    it('refuses a path GROWI reserves, creating nothing', async () => {
      const user = await createGrowiUser();
      const path = `/admin/chat-summary-${Date.now()}-${seq}`;

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: path,
        title: 'ignored',
        body: 'summary body',
        now: NOW,
        auditContext: auditContext(),
      });

      expect(result).toEqual({ kind: 'failed', reason: 'forbidden' });
      expect(await Page.countDocuments({ path })).toBe(0);
    });

    it("refuses a path under another user's owner-only page, creating nothing", async () => {
      const owner = await createGrowiUser();
      const user = await createGrowiUser();
      const parentPath = `/chat-summary-private-${Date.now()}-${seq}`;
      await createOwnerOnlyPage(parentPath, owner);

      const result = await createSummaryPage({
        crowi,
        user,
        requestedPath: `${parentPath}/child`,
        title: 'ignored',
        body: 'summary body',
        now: NOW,
        auditContext: auditContext(),
      });

      expect(result).toEqual({ kind: 'failed', reason: 'forbidden' });
      expect(await Page.countDocuments({ path: `${parentPath}/child` })).toBe(
        0,
      );
    });
  });
});
