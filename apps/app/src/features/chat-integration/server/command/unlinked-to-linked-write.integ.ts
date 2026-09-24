// Task 10.3's completion condition, proved as ONE continuous flow against the
// real DB: a chat account that is not linked yet runs a write command, follows
// the one-time link it is handed, approves it through the real approval route,
// and only then can write -- and that write leaves exactly one audit row
// naming both the operator and the channel the command came from.
//
// What stays real here (this is the point of the file -- the pieces already
// have their own unit/integration tests; what is unproven is that they compose):
//   - `createCommandEndpoint` (`command-endpoint.ts`) with the real
//     `resolveActor`, real `chat_account_links` / `User` documents
//   - the one-time order issued by the refusal itself
//     (`findOrCreatePendingAccountLinkOrder`), consumed through the real
//     `createAccountLinkRouter` + real `loginRequiredFactory` over supertest
//     -- NOT by calling `approveAccountLink` directly
//   - `crowi.pageService.create` (real page write)
//   - the whole Activity lifecycle: `beginActivity` -> emit -> the real
//     `ActivityService` 'update' listener -> `settleActivityRecord` ->
//     `prisma.activities`, read back from the database
//
// Nothing external is stubbed except the two fire-and-forget page-create
// sub-operations whose async DB work would otherwise outlive the test (the
// same stubs `service/page/grant-preserve-on-update.integ.ts` uses, and for
// the same reason); neither touches what is asserted below.
//
// Requirements: 4.3, 4.4, 7.3, 7.6.

import type { ChannelRef, ChatAccountRef, CommandRequest } from '@growi/chat';
import type { IUserHasId } from '@growi/core';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import { prisma } from '~/utils/prisma';

import { createAccountLinkRouter } from '../account-link/account-link-router';
import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatAccountLinkOrder } from '../account-link/models/chat-account-link-order';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { ChatRelation } from '../models/chat-relation';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import {
  type CommandAuditContext,
  createCommandEndpoint,
} from './command-endpoint';

const RELATION_ID = 'relation-10-3-e2e';
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: 'C0LINKAUDIT',
  channelName: 'link-audit-channel',
  isPrivate: false,
};
/** Unique to this file: every Activity assertion below is scoped by it, so a
 * concurrently-running suite's rows can never be mistaken for this one's. */
const TEST_IP = '10.0.0.103';
const TEST_ENDPOINT = '/_api/v3/chat-integration/peer/command-10-3';
const ACCOUNT_LINK_MOUNT_PATH = '/_api/v3/chat-integration/account-link';
const USERNAME_PREFIX = 'chat-e2e-';
/** Every page this suite writes lives under this prefix, so `beforeEach` can
 * clear what a crashed earlier run left behind -- a leftover page at a path
 * this suite is about to write to would answer `path-conflict` instead of
 * creating it. */
const TARGET_PATH_PREFIX = '/chat-e2e-target-';
/** ...and the path itself carries a per-run component, so two runs never
 * contend for the same path even if the cleanup above never got to run. */
const RUN_ID = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
/** Set for this suite so "which GROWI is this link for" is a real, checkable
 * answer -- with `app:siteUrl` / `app:title` unset the guidance would carry
 * GROWI's "site URL is not set" placeholder and the generic 'GROWI' title,
 * and the assertions below would pass without proving anything. */
const SITE_URL = 'https://growi-10-3.example.test';
const APP_TITLE = 'E2E GROWI for task 10.3';

/** Long enough for the 'update' listener's settle write to land, short enough not to stall the suite. */
const ACTIVITY_WAIT_MS = 5000;
/** Grace period used to prove NO row appears (a row written late must not pass as "none"). */
const ACTIVITY_QUIET_MS = 500;

let seq = 0;

const buildAuditContext = (): CommandAuditContext => ({
  ip: TEST_IP,
  endpoint: TEST_ENDPOINT,
  requestArrivedAt: new Date(),
});

const nextActor = (): ChatAccountRef => {
  seq += 1;
  return {
    platform: 'slack',
    accountId: `U0CHATTER-${seq}`,
    displayName: `Chatter ${seq}`,
  };
};

const createPageRequest = (
  actor: ChatAccountRef,
  overrides: { path?: string; requestId?: string } = {},
): Extract<CommandRequest, { kind: 'create-page' }> => {
  seq += 1;
  return {
    relationId: RELATION_ID,
    op: 'command',
    requestId: overrides.requestId ?? `req-10-3-${seq}`,
    actor,
    channel: CHANNEL,
    kind: 'create-page',
    path: overrides.path ?? `${TARGET_PATH_PREFIX}${RUN_ID}-${seq}`,
    body: 'written from chat after linking',
  } as Extract<CommandRequest, { kind: 'create-page' }>;
};

type ActivityRow = Awaited<
  ReturnType<typeof prisma.activities.findMany>
>[number];

const findActivityRows = (): Promise<ActivityRow[]> =>
  prisma.activities.findMany({ where: { ip: TEST_IP } });

/** Waits until at least one row exists, then keeps watching briefly so a
 * second (unwanted) row cannot slip in after the assertion. */
const waitForActivityRows = async (): Promise<ActivityRow[]> => {
  const deadline = Date.now() + ACTIVITY_WAIT_MS;
  while (Date.now() < deadline) {
    const rows = await findActivityRows();
    if (rows.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, ACTIVITY_QUIET_MS));
      return findActivityRows();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return findActivityRows();
};

/** Proves the absence of a row rather than merely reading too early. */
const expectNoActivityRecorded = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ACTIVITY_QUIET_MS));
  expect(await findActivityRows()).toHaveLength(0);
};

describe('chat write: unlinked -> one-time link -> linked write -> audit row (task 10.3)', () => {
  let crowi: Crowi;
  let Page: PageModel;

  /** The approval screen's real router, with `req.user` set the way passport
   * would have by the time the router's `loginRequiredStrictly` runs. */
  const buildAccountLinkApp = (loggedInUser?: IUserHasId): Express => {
    // Install `res.apiv3` / `res.apiv3Err` on THIS app's responses only --
    // mutating the shared `express` module would leak into every app built
    // later in the same worker (see `pages/rename.integ.ts`'s header).
    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    const app = express();
    app.use(express.json());
    app.use((_req: Request, res: Response, next: NextFunction) => {
      Object.assign(res, responseHelpers.response);
      next();
    });
    if (loggedInUser != null) {
      app.use((req: Request, _res: Response, next: NextFunction) => {
        (req as Request & { user: IUserHasId }).user = loggedInUser;
        next();
      });
    }
    app.use(ACCOUNT_LINK_MOUNT_PATH, createAccountLinkRouter(crowi));
    return app;
  };

  const createGrowiUser = async (
    overrides: { status?: number; readOnly?: boolean } = {},
  ): Promise<HydratedDocument<IUserHasId>> => {
    seq += 1;
    return crowi.models.User.create({
      name: `Chat E2E ${seq}`,
      username: `${USERNAME_PREFIX}${seq}`,
      email: `${USERNAME_PREFIX}${seq}@example.com`,
      status: overrides.status ?? UserStatus.STATUS_ACTIVE,
      readOnly: overrides.readOnly ?? false,
    }) as unknown as Promise<HydratedDocument<IUserHasId>>;
  };

  const linkAccount = (
    actor: ChatAccountRef,
    user: HydratedDocument<IUserHasId>,
  ) =>
    ChatAccountLink.create({
      relationId: RELATION_ID,
      userId: user._id,
      platform: actor.platform,
      accountId: actor.accountId,
      linkedAt: new Date(),
    });

  /** The token as the chat user receives it: parsed out of the `linkUrl` they
   * were handed, never read from the database. */
  const tokenFromLinkUrl = (linkUrl: string): string => {
    const segments = new URL(linkUrl).pathname.split('/');
    return segments[segments.length - 1];
  };

  const runCommand = (req: CommandRequest) =>
    createCommandEndpoint(crowi).handle(req, buildAuditContext());

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    await configManager.updateConfigs({
      'app:isV5Compatible': true,
      'app:siteUrl': SITE_URL,
      'app:title': APP_TITLE,
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });

    // `pageService.create` needs a root page, and fires two sub-operations it
    // does not await; stub those so their DB work cannot outlive the test.
    // Neither carries the grant, the created page, or the Activity this file
    // asserts on.
    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
    vi.spyOn(crowi.pageService, 'createSubOperation').mockResolvedValue();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  }, 120_000);

  beforeEach(async () => {
    await Promise.all([
      ChatAccountLink.deleteMany({ relationId: RELATION_ID }),
      ChatAccountLinkOrder.deleteMany({ relationId: RELATION_ID }),
      ChatProcessedRequest.deleteMany({ relationId: RELATION_ID }),
      ChatChannelPermission.deleteMany({ relationId: RELATION_ID }),
      ChatRelation.deleteMany({ relationId: RELATION_ID }),
      crowi.models.User.deleteMany({
        username: new RegExp(`^${USERNAME_PREFIX}`),
      }),
      prisma.activities.deleteMany({ where: { ip: TEST_IP } }),
      Page.deleteMany({ path: new RegExp(`^${TARGET_PATH_PREFIX}`) }),
    ]);

    await ChatRelation.create({
      relationId: RELATION_ID,
      proxyUri: 'https://proxy.example.test',
      platform: 'slack',
      workspaceId: 'workspace-10-3',
      workspaceName: 'E2E Workspace',
      label: 'Our Slack',
      state: 'active',
      settingsVersion: 0,
      createdAt: new Date(),
    });

    // `judge` default-denies a write command with no stored permission row
    // (Requirement 11.3/11.5) -- this suite is about what happens after that
    // gate, so the channel is explicitly allowed for every test here.
    await ChatChannelPermission.create({
      relationId: RELATION_ID,
      commandName: 'create-page',
      allowedChannels: [CHANNEL.channelId],
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await Promise.all([
      prisma.activities.deleteMany({ where: { ip: TEST_IP } }),
      crowi.models.User.deleteMany({
        username: new RegExp(`^${USERNAME_PREFIX}`),
      }),
      Page.deleteMany({ path: new RegExp(`^${TARGET_PATH_PREFIX}`) }),
    ]);
    await configManager.updateConfigs(
      {
        'app:siteUrl': undefined,
        'app:title': undefined,
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  describe('an unlinked chat account running a write command (Requirement 4.4, 7.6)', () => {
    it('is refused with guidance that names WHICH GROWI the link is for, and a one-time link to that same GROWI', async () => {
      const actor = nextActor();

      const response = await runCommand(createPageRequest(actor));

      expect(response.kind).toBe('account-link-required');
      if (response.kind !== 'account-link-required') {
        return;
      }
      // Which GROWI: the app's own title, so a chat workspace wired to more
      // than one GROWI cannot leave the reader guessing which one refused.
      expect(response.growiLabel).toBe(APP_TITLE);
      expect(response.growiLabel).toBe(crowi.appService.getAppTitle());
      // ...and the link goes to that same GROWI, not just to "an" account-link
      // screen somewhere.
      expect(growiInfoService.getSiteUrl()).toBe(SITE_URL);
      expect(response.linkUrl.startsWith(`${SITE_URL}/`)).toBe(true);

      // The link is live and belongs to this chat account on this relation.
      const order = await ChatAccountLinkOrder.findOne({
        token: tokenFromLinkUrl(response.linkUrl),
      });
      expect(order).not.toBeNull();
      expect(order?.relationId).toBe(RELATION_ID);
      expect(order?.accountId).toBe(actor.accountId);
      expect(order?.isRevoked).toBe(false);

      // A refusal is not an operation attempt -- nothing is audited.
      await expectNoActivityRecorded();
    });
  });

  describe('following the one-time link and approving it (Requirement 7.3, 7.4)', () => {
    it('completes the link for the logged-in user, and the SAME link cannot be used a second time', async () => {
      const actor = nextActor();
      const user = await createGrowiUser();

      const refusal = await runCommand(createPageRequest(actor));
      expect(refusal.kind).toBe('account-link-required');
      if (refusal.kind !== 'account-link-required') {
        return;
      }
      const token = tokenFromLinkUrl(refusal.linkUrl);
      const app = buildAccountLinkApp(user as unknown as IUserHasId);

      // The screen shows which chat account is about to be tied to which
      // GROWI user -- what Requirement 7.3 requires before approving.
      const screen = await request(app).get(
        `${ACCOUNT_LINK_MOUNT_PATH}/${token}`,
      );
      expect(screen.status).toBe(200);
      expect(screen.body).toMatchObject({
        platform: actor.platform,
        accountId: actor.accountId,
        workspaceName: 'E2E Workspace',
        growiUsername: user.username,
      });

      const approval = await request(app).post(
        `${ACCOUNT_LINK_MOUNT_PATH}/${token}/approve`,
      );
      expect(approval.status).toBe(200);

      const links = await ChatAccountLink.find({
        relationId: RELATION_ID,
        platform: actor.platform,
        accountId: actor.accountId,
      });
      expect(links).toHaveLength(1);
      expect(links[0].userId.toString()).toBe(user._id.toString());

      // One-time use: the same token, replayed by the same logged-in user,
      // is refused and changes nothing.
      const replay = await request(app).post(
        `${ACCOUNT_LINK_MOUNT_PATH}/${token}/approve`,
      );
      expect(replay.status).toBe(404);
      expect(
        await ChatAccountLink.countDocuments({
          relationId: RELATION_ID,
          platform: actor.platform,
          accountId: actor.accountId,
        }),
      ).toBe(1);

      // The same token is also dead for the approval screen, so a stale tab
      // cannot present it as still pending.
      const screenAfter = await request(app).get(
        `${ACCOUNT_LINK_MOUNT_PATH}/${token}`,
      );
      expect(screenAfter.status).toBe(404);
    });
  });

  describe('the first write after the link is completed (Requirement 4.3)', () => {
    it('creates the page and leaves exactly one audit row holding both the operator and the originating channel', async () => {
      const actor = nextActor();
      const user = await createGrowiUser();

      // Stage 1: refused, handed a link.
      const refusal = await runCommand(createPageRequest(actor));
      expect(refusal.kind).toBe('account-link-required');
      if (refusal.kind !== 'account-link-required') {
        return;
      }

      // Stage 2: approved through the real route.
      const approval = await request(
        buildAccountLinkApp(user as unknown as IUserHasId),
      ).post(
        `${ACCOUNT_LINK_MOUNT_PATH}/${tokenFromLinkUrl(refusal.linkUrl)}/approve`,
      );
      expect(approval.status).toBe(200);

      // Stage 3: the very same chat account writes -- now permitted.
      const writeRequest = createPageRequest(actor);
      const written = await runCommand(writeRequest);

      expect(written.kind).toBe('created');
      const createdPage = await Page.findOne({ path: writeRequest.path });
      expect(createdPage).not.toBeNull();

      const rows = await waitForActivityRows();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.action).toBe(SupportedAction.ACTION_PAGE_CREATE);
      // The operator: the GROWI user the chat account was linked to, by id
      // AND by the name kept on the row's snapshot.
      expect(row.userId).toBe(user._id.toString());
      expect(row.snapshot.username).toBe(user.username);
      // The originating channel: `CommandEnvelope.channel`'s matching
      // identifier (platform + channelId) must be recoverable from the row.
      // `Activity` has no dedicated channel field, so this asserts the
      // identifier survives somewhere on the row, not any particular format.
      const rowText = JSON.stringify(row);
      expect(rowText).toContain(CHANNEL.platform);
      expect(rowText).toContain(CHANNEL.channelId);
      // The page it recorded is the page that was actually created.
      expect(row.target).toBe(createdPage?._id.toString());
    });
  });

  describe('a linked user who may not write (Requirement 4.4)', () => {
    it('refuses a suspended user without offering a pointless account link, and audits nothing', async () => {
      const actor = nextActor();
      const suspended = await createGrowiUser({
        status: UserStatus.STATUS_SUSPENDED,
      });
      await linkAccount(actor, suspended);

      const response = await runCommand(createPageRequest(actor));

      // Already linked -- so "go link your account" would change nothing for
      // them; they get a plain refusal instead.
      expect(response).toEqual({
        kind: 'error',
        code: 'forbidden',
        message: expect.any(String),
      });
      await expectNoActivityRecorded();
    });

    it('refuses a read-only user, and audits nothing', async () => {
      const actor = nextActor();
      const readOnly = await createGrowiUser({ readOnly: true });
      await linkAccount(actor, readOnly);

      const response = await runCommand(createPageRequest(actor));

      expect(response).toEqual({
        kind: 'error',
        code: 'forbidden',
        message: expect.any(String),
      });
      await expectNoActivityRecorded();
    });

    it('lets a read-only user write once the read-only flag is lifted (the refusal is the flag, not the link)', async () => {
      const actor = nextActor();
      const user = await createGrowiUser({ readOnly: true });
      await linkAccount(actor, user);

      const refused = await runCommand(createPageRequest(actor));
      expect(refused.kind).toBe('error');

      await crowi.models.User.updateOne({ _id: user._id }, { readOnly: false });

      const written = await runCommand(createPageRequest(actor));
      expect(written.kind).toBe('created');
    });
  });
});
