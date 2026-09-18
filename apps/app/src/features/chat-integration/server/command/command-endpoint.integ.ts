// Task 5.2's completion condition, proved against the real DB (real Prisma
// `activities`, real Mongo `Page`/`User`/`chat_account_links`): the two
// write commands (`create-page` and `keep`) each check "may this actor write
// here" and "does this path already exist" BEFORE writing, answer the two
// refusals with DISTINCT response codes, and record an Activity for every
// outcome once resolveActor has determined a real, permitted operator --
// but never before that point (design.md: "断った要求... は記録しない").
//
// `pageService.create` itself is stubbed per test (like
// `page/create-page.integ.ts` does) -- its own internals are GROWI's
// existing, already-tested page-creation logic, not this task's concern.
// Everything this task actually adds stays real: `performWriteCommand`'s own
// `isCreatablePage` / path-existence gates (real `Page.exists` queries),
// `resolveActor` (real `chat_account_links` + `User` documents), and the
// full Activity lifecycle (`beginActivity` -> emit -> the real
// `ActivityService` 'update' listener -> `settleActivityRecord` ->
// `prisma.activities`, or `beginActivity` -> `recordFailsafeAttempt` ->
// `prisma.activities` on the failure paths).
//
// Requires a real MongoDB (wired by vitest.workspace.mts integ setup) with
// Prisma bound to the same per-worker database (test/setup/prisma.ts).

import type { ChannelRef, ChatAccountRef, CommandRequest } from '@growi/chat';
import type { IUserHasId } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import * as activityModule from '~/server/service/activity/index';
import * as pendingActivityContext from '~/server/service/activity/pending-activity-context';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { ChatProcessedRequest } from '../models/chat-processed-request';
import { ChatChannelPermission } from '../settings/models/chat-channel-permission';
import {
  type CommandAuditContext,
  createCommandEndpoint,
} from './command-endpoint';

vi.mock('~/server/service/activity/index', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('~/server/service/activity/index')>();
  return {
    ...actual,
    // Wraps the REAL implementation (still mints an id, still stashes the
    // context) so this file can read back the minted id from
    // `.mock.results` without changing behavior -- the leak check below
    // needs to know which id to look up in `pendingActivityContext`.
    beginActivity: vi.fn(actual.beginActivity),
  };
});

const RELATION_ID = 'relation-write-1';
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: 'C0WRITE',
  channelName: 'write-channel',
  isPrivate: false,
};
const TEST_IP = '10.0.0.114';
const TEST_ENDPOINT = '/_api/v3/chat-integration/peer/command-integ';

const buildAuditContext = (): CommandAuditContext => ({
  ip: TEST_IP,
  endpoint: TEST_ENDPOINT,
  requestArrivedAt: new Date(),
});

let seq = 0;
const nextActor = (): ChatAccountRef => {
  seq += 1;
  return {
    platform: 'slack',
    accountId: `U0WRITER-${seq}`,
    displayName: `Writer ${seq}`,
  };
};

const createPageRequest = (
  overrides: Partial<Extract<CommandRequest, { kind: 'create-page' }>> = {},
): Extract<CommandRequest, { kind: 'create-page' }> =>
  ({
    relationId: RELATION_ID,
    op: 'command',
    requestId: `req-create-${++seq}`,
    actor: nextActor(),
    channel: CHANNEL,
    kind: 'create-page',
    path: `/chat-write-target-${seq}`,
    body: 'created via chat',
    ...overrides,
  }) as Extract<CommandRequest, { kind: 'create-page' }>;

const keepRequest = (
  overrides: Partial<Extract<CommandRequest, { kind: 'keep' }>> = {},
): Extract<CommandRequest, { kind: 'keep' }> =>
  ({
    relationId: RELATION_ID,
    op: 'command',
    requestId: `req-keep-${++seq}`,
    actor: nextActor(),
    channel: CHANNEL,
    kind: 'keep',
    path: `/chat-keep-target-${seq}`,
    messages: [
      {
        postedAt: '2026-01-01T00:00:00.000Z',
        author: nextActor(),
        markdown: 'first message',
      },
    ],
    ...overrides,
  }) as Extract<CommandRequest, { kind: 'keep' }>;

async function waitForActivityRows(
  where: { id: string },
  maxWaitMs = 5000,
): Promise<Awaited<ReturnType<typeof prisma.activities.findMany>>> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const rows = await prisma.activities.findMany({ where });
    if (rows.length > 0) {
      return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

describe('createCommandEndpoint -- write commands (task 5.2, real DB)', () => {
  let crowi: Crowi;

  beforeAll(async () => {
    crowi = await getInstance();
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Large,
    });
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      ChatProcessedRequest.deleteMany({}),
      ChatChannelPermission.deleteMany({}),
      crowi.models.User.deleteMany({}),
      // biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
      mongoose.model<any>('Page').deleteMany({}),
      prisma.activities.deleteMany({ where: { ip: TEST_IP } }),
    ]);
    // `judge` (design.md's channel-permission check, run before anything
    // else) default-denies a write command with no stored settings row
    // (Requirement 11.3/11.5's "no-settings" default) -- this suite is about
    // what happens AFTER that gate, so both write commands are explicitly
    // allowed in this channel for every test here.
    await ChatChannelPermission.create([
      {
        relationId: RELATION_ID,
        commandName: 'create-page',
        allowedChannels: [CHANNEL.channelId],
      },
      {
        relationId: RELATION_ID,
        commandName: 'keep',
        allowedChannels: [CHANNEL.channelId],
      },
    ]);
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  const createLinkedActiveUser = async (
    actor: ChatAccountRef,
    overrides: { status?: number; readOnly?: boolean } = {},
  ): Promise<IUserHasId> => {
    seq += 1;
    const user = await crowi.models.User.create({
      name: `writer ${seq}`,
      username: `writer-${seq}`,
      email: `writer-${seq}@example.com`,
      status: overrides.status ?? UserStatus.STATUS_ACTIVE,
      readOnly: overrides.readOnly ?? false,
    });
    await ChatAccountLink.create({
      relationId: RELATION_ID,
      userId: user._id,
      platform: actor.platform,
      accountId: actor.accountId,
      linkedAt: new Date(),
    });
    return user as unknown as IUserHasId;
  };

  /** Looks up the id `beginActivity` minted for the Nth call, and proves it left no leftover entry in `pendingActivityContext`. */
  const assertNoLeakForCall = (callIndex: number): void => {
    const { activityId } = vi.mocked(activityModule.beginActivity).mock.results[
      callIndex
    ].value as { activityId: string };
    expect(pendingActivityContext.take(activityId)).toBeUndefined();
  };

  describe('create-page — success (Requirement 4.2, 4.3)', () => {
    it('creates the page, records ACTION_PAGE_CREATE with the operator, and leaves no pending-context entry', async () => {
      const actor = nextActor();
      const user = await createLinkedActiveUser(actor);
      const request = createPageRequest({ actor });

      const pageId = new Types.ObjectId();
      vi.spyOn(crowi.pageService, 'create').mockResolvedValue({
        _id: pageId,
        path: request.path,
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page create
      } as any);

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response).toEqual({
        kind: 'created',
        pageUrl: expect.stringContaining(request.path),
      });
      expect(crowi.pageService.create).toHaveBeenCalledWith(
        request.path,
        request.body,
        expect.objectContaining({ _id: user._id }),
        {},
      );

      const activityId = vi.mocked(activityModule.beginActivity).mock.results[0]
        .value.activityId as string;
      const rows = await waitForActivityRows({ id: activityId });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(SupportedAction.ACTION_PAGE_CREATE);
      expect(rows[0].userId).toBe(user._id.toString());

      assertNoLeakForCall(0);
    });
  });

  describe('create-page — permission denied (Requirement 4.5)', () => {
    it('answers "forbidden", distinct from path-conflict, and records ONE ACTION_UNSETTLED attempt (not a full create)', async () => {
      const actor = nextActor();
      const user = await createLinkedActiveUser(actor);
      // '/me' is a reserved path -- isCreatablePage('/me') is false
      // (packages/core/src/utils/page-path-utils/index.spec.ts).
      const request = createPageRequest({ actor, path: '/me' });

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response).toEqual({
        kind: 'error',
        code: 'forbidden',
        message: expect.any(String),
      });
      expect(crowi.pageService.create).not.toHaveBeenCalled();

      const activityId = vi.mocked(activityModule.beginActivity).mock.results[0]
        .value.activityId as string;
      const rows = await prisma.activities.findMany({
        where: { id: activityId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(SupportedAction.ACTION_UNSETTLED);
      expect(rows[0].userId).toBe(user._id.toString());

      assertNoLeakForCall(0);
    });
  });

  describe('create-page — path conflict (Requirement 4.6)', () => {
    it('answers "path-conflict", distinct from forbidden, without calling pageService.create', async () => {
      const actor = nextActor();
      await createLinkedActiveUser(actor);
      const path = `/chat-write-conflict-${++seq}`;
      // biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
      const Page = mongoose.model<any>('Page');
      await Page.create({ path, isEmpty: false });

      const request = createPageRequest({ actor, path });

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response.kind).toBe('error');
      if (response.kind === 'error') {
        expect(response.code).toBe('path-conflict');
      }
      expect(crowi.pageService.create).not.toHaveBeenCalled();

      assertNoLeakForCall(0);
    });
  });

  describe('write denial — not-linked / read-only (Requirement 4.4, 4.5, 7.6)', () => {
    it('refuses an unlinked actor with account-link-required and records NO activity at all', async () => {
      const actor = nextActor();
      const request = createPageRequest({ actor });

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response.kind).toBe('account-link-required');
      expect(crowi.pageService.create).not.toHaveBeenCalled();
      expect(activityModule.beginActivity).not.toHaveBeenCalled();

      const rows = await prisma.activities.findMany({
        where: { ip: TEST_IP },
      });
      expect(rows).toHaveLength(0);
    });

    it('refuses a read-only actor with forbidden and records NO activity at all', async () => {
      const actor = nextActor();
      await createLinkedActiveUser(actor, { readOnly: true });
      const request = createPageRequest({ actor });

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response).toEqual({
        kind: 'error',
        code: 'forbidden',
        message: expect.any(String),
      });
      expect(crowi.pageService.create).not.toHaveBeenCalled();
      expect(activityModule.beginActivity).not.toHaveBeenCalled();

      const rows = await prisma.activities.findMany({
        where: { ip: TEST_IP },
      });
      expect(rows).toHaveLength(0);
    });
  });

  describe('keep — reuses the same 3 write properties (Requirement 5.2, 5.3)', () => {
    it('builds the page body from the imported messages (task 4.3), attributes the linked speaker, and creates the page', async () => {
      const runnerActor = nextActor();
      const runner = await createLinkedActiveUser(runnerActor);
      const speakerActor = nextActor();
      await createLinkedActiveUser(speakerActor);

      const request = keepRequest({
        actor: runnerActor,
        messages: [
          {
            postedAt: '2026-01-01T00:00:00.000Z',
            author: speakerActor,
            markdown: 'hello from the transcript',
          },
        ],
      });

      const pageId = new Types.ObjectId();
      vi.spyOn(crowi.pageService, 'create').mockResolvedValue({
        _id: pageId,
        path: request.path,
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page create
      } as any);

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response).toEqual({
        kind: 'created',
        pageUrl: expect.stringContaining(request.path),
        importedMessageCount: 1,
      });
      // The created page's author is the person who ran `keep` (the
      // resolved actor), NOT the message's speaker.
      expect(crowi.pageService.create).toHaveBeenCalledWith(
        request.path,
        expect.stringContaining('hello from the transcript'),
        expect.objectContaining({ _id: runner._id }),
        {},
      );
    });
  });

  describe('audit log retains the operator and the originating channel (task 5.3, Requirement 4.3)', () => {
    it('create-page: the Activity row keeps both the operator and the chat channel the command came from', async () => {
      const actor = nextActor();
      const user = await createLinkedActiveUser(actor);
      const request = createPageRequest({ actor });

      const pageId = new Types.ObjectId();
      vi.spyOn(crowi.pageService, 'create').mockResolvedValue({
        _id: pageId,
        path: request.path,
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page create
      } as any);

      const endpoint = createCommandEndpoint(crowi);
      await endpoint.handle(request, buildAuditContext());

      const activityId = vi.mocked(activityModule.beginActivity).mock.results[0]
        .value.activityId as string;
      const rows = await waitForActivityRows({ id: activityId });
      expect(rows).toHaveLength(1);
      // Operator: who performed the write.
      expect(rows[0].userId).toBe(user._id.toString());
      // Originating channel: `CommandEnvelope.channel` (`CHANNEL` here) must
      // be recoverable from the row -- design.md: "チャット経由であること
      // と発言元のチャンネルを残す". `Activity` has no dedicated channel
      // field, so this only checks that the channel's matching identifier
      // (`platform` + `channelId`) survives somewhere on the row, not any
      // particular field/format.
      expect(rows[0].endpoint).toContain(CHANNEL.platform);
      expect(rows[0].endpoint).toContain(CHANNEL.channelId);
    });

    it('keep: the Activity row keeps both the operator and the chat channel the command came from', async () => {
      const runnerActor = nextActor();
      const runner = await createLinkedActiveUser(runnerActor);
      const request = keepRequest({ actor: runnerActor });

      const pageId = new Types.ObjectId();
      vi.spyOn(crowi.pageService, 'create').mockResolvedValue({
        _id: pageId,
        path: request.path,
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page create
      } as any);

      const endpoint = createCommandEndpoint(crowi);
      await endpoint.handle(request, buildAuditContext());

      const activityId = vi.mocked(activityModule.beginActivity).mock.results[0]
        .value.activityId as string;
      const rows = await waitForActivityRows({ id: activityId });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(runner._id.toString());
      expect(rows[0].endpoint).toContain(CHANNEL.platform);
      expect(rows[0].endpoint).toContain(CHANNEL.channelId);
    });

    it('a failed write attempt (path-conflict) still keeps the channel on its ACTION_UNSETTLED row', async () => {
      const actor = nextActor();
      await createLinkedActiveUser(actor);
      const request = createPageRequest({ actor });

      // biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
      const Page = mongoose.model<any>('Page');
      await Page.create({ path: request.path, isEmpty: false });

      const endpoint = createCommandEndpoint(crowi);
      const response = await endpoint.handle(request, buildAuditContext());

      expect(response).toEqual({
        kind: 'error',
        code: 'path-conflict',
        message: expect.any(String),
      });

      const activityId = vi.mocked(activityModule.beginActivity).mock.results[0]
        .value.activityId as string;
      const rows = await waitForActivityRows({ id: activityId });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe(SupportedAction.ACTION_UNSETTLED);
      expect(rows[0].endpoint).toContain(CHANNEL.platform);
      expect(rows[0].endpoint).toContain(CHANNEL.channelId);
    });
  });

  describe('idempotency for a write command (Requirement 10.4)', () => {
    it('replays the stored response for a repeated (relationId, requestId), creating the page only once and recording only one Activity', async () => {
      const actor = nextActor();
      const user = await createLinkedActiveUser(actor);
      const request = createPageRequest({ actor });

      const pageId = new Types.ObjectId();
      vi.spyOn(crowi.pageService, 'create').mockResolvedValue({
        _id: pageId,
        path: request.path,
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the page create
      } as any);

      const endpoint = createCommandEndpoint(crowi);
      const first = await endpoint.handle(request, buildAuditContext());
      const second = await endpoint.handle(request, buildAuditContext());

      expect(second).toEqual(first);
      expect(crowi.pageService.create).toHaveBeenCalledTimes(1);
      expect(activityModule.beginActivity).toHaveBeenCalledTimes(1);

      const activityId = vi.mocked(activityModule.beginActivity).mock.results[0]
        .value.activityId as string;
      const rows = await waitForActivityRows({ id: activityId });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(user._id.toString());
    });
  });
});
