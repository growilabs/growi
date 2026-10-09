// Task 11.3 -- the notification flow and the account-linking flow, driven end
// to end against a real PostgreSQL.
//
// **This file is EXPECTED to be red in this devcontainer**, for the same
// reason `harness-round-trip.integ.ts` and `command-flow-e2e.integ.ts` are:
// the `postgres` hostname does not resolve here (Implementation Note 1.2).
// That is not a defect of this task. There is deliberately no `beforeAll` --
// a failing `beforeAll` SKIPS the bodies, so not one assertion below would
// ever be parsed while storage is unreachable, and a mistake in them would
// stay hidden long after this task closed.
//
// **The two halves travel in OPPOSITE directions, and that is the point.**
//
//  - A notification comes INTO this proxy: the fake GROWI signs a request
//    with `@growi/chat`'s own `sign()` and the running proxy's real
//    `signatureGuard` has to accept it on its merits, after which the real
//    `InboundFlow` judges each destination against the saved channel
//    inventory and posts through the facade. What the fixture therefore needs
//    is a `peer_key` (`trustGrowiSignature`) -- the `own_key` `pairGrowi`
//    mints is unused in the first two cases, and is kept only because a
//    relation is created the one way every other test creates one.
//  - An account-link notice goes OUT to a chat user: a command travels
//    proxy -> GROWI, GROWI refuses it, and the refusal comes back as a
//    message only the person who typed it can see.
//
// **Which requirement is actually checkable here.** Of 11.3's list, only
// Requirement 2.4 is a criterion this proxy answers for: 「投稿できなかった
// こと・対象のチャンネル・投稿できるようにするために必要な操作 を運用者が後
// から確認できる形で記録する」. That is why the failing destination below
// fails as `bot-not-in-channel` with a remedy rather than as a generic error:
// the remedy is the 「必要な操作」, and `outcomeOfPost` is the one place that
// carries it back instead of flattening it into `detail`. Requirements 2.1,
// 2.2, 2.5 and 2.6 are GROWI-application criteria (Implementation Note 8.2
// says the same), and 7.3 belongs to the GROWI that decides whether a chat
// account is really the user's; what is checkable of 7.6 is its relay half --
// the write does not run, and the way out names which GROWI and reaches only
// the person who asked.

import { randomUUID } from 'node:crypto';
import { OP_NAMES } from '@growi/chat';
import { afterEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../db/index.js';
import type { ProxyConfig } from '../runtime/index.js';
import type { OutboundMessage, PostOutcome } from '../types/index.js';
import { actionOn, mentionOn, modalSubmitOn } from './chat-events.js';
import type { CapturedPost, FakeChatService } from './fake-chat-service.js';
import { createFakeChatService } from './fake-chat-service.js';
import type { FakeGrowi, FakeGrowiOptions } from './fake-growi.js';
import { startFakeGrowi } from './fake-growi.js';
import type { FreePortListener } from './free-port.js';
import { LOOPBACK, listenOnFreePort } from './free-port.js';
import type { Workspace } from './paired-workspace.js';
import {
  addChannel,
  markInventoryReady,
  openWorkspace,
  pairGrowi,
  passthroughCipher,
  permitWrite,
  trustGrowiSignature,
} from './paired-workspace.js';
import { type ProxyCluster, startProxyCluster } from './proxy-cluster.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

/**
 * Every fake GROWI listens on loopback, so one allow-list entry serves them
 * all: `GrowiUriResolver` judges the ADDRESS, and they all resolve to this
 * one. Without it the socket is refused before it is opened (Implementation
 * Note 11.1 (f)).
 */
const proxyConfig = (): ProxyConfig => ({
  platformApp: { stateConnectionString: CHAT_SDK_DATABASE_URL },
  closedNetwork: { allowList: [LOOPBACK], trustedCaCertsFor: () => [] },
  cipher: passthroughCipher,
  databaseUrl: DATABASE_URL,
  http: { port: 0, bodyLimitBytes: 1024 * 1024 },
  mattermostInstallations: [],
});

let cluster: ProxyCluster | null = null;
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await cluster?.stopAll();
  cluster = null;
  await Promise.all(closers.splice(0).map((close) => close()));
});

const openDb = (): PrismaClient => {
  const db = createPrismaClient(DATABASE_URL);
  closers.push(() => db.$disconnect());
  return db;
};

const startOneProxy = async (
  chat: FakeChatService,
): Promise<FreePortListener> => {
  const listener = listenOnFreePort();
  cluster = await startProxyCluster([
    {
      name: 'only',
      config: proxyConfig(),
      overrides: { listen: listener.listen, createFacade: chat.createFacade },
    },
  ]);
  return listener;
};

const openGrowi = async (
  options: FakeGrowiOptions = {},
): Promise<FakeGrowi> => {
  const growi = await startFakeGrowi(options);
  closers.push(growi.close);
  return growi;
};

// ---------------------------------------------------------------------------
// Reading what the proxy sent back
// ---------------------------------------------------------------------------

const postsTo = (
  chat: FakeChatService,
  channelId: string,
): ReadonlyArray<CapturedPost> =>
  chat.posts().filter((post) => post.channel.channelId === channelId);

/** The 「どの GROWI に対して?」 question, however the service renders it. */
const lastChoice = (
  chat: FakeChatService,
): Extract<OutboundMessage, { kind: 'choice' }> => {
  const choice = chat
    .posts()
    .flatMap((post) => (post.message.kind === 'choice' ? [post.message] : []))
    .at(-1);
  if (choice == null) throw new Error('the proxy asked for no GROWI choice');
  return choice;
};

const onlyEphemeral = (chat: FakeChatService): CapturedPost => {
  const ephemerals = chat.posts().filter((post) => post.kind === 'ephemeral');
  const [only, ...rest] = ephemerals;
  if (only == null || rest.length > 0) {
    throw new Error(
      `expected exactly one ephemeral message, got ${ephemerals.length}`,
    );
  }
  return only;
};

const markdownOf = (post: CapturedPost): string =>
  post.message.kind === 'markdown' ? post.message.markdown : '';

// ---------------------------------------------------------------------------
// 通知 (Requirement 2.4)
// ---------------------------------------------------------------------------

const NOTIFICATION_MARKDOWN =
  'GROWI のページが更新されました: http://growi-a.test/notes/minutes';

/** What an operator has to do; carried back verbatim or not at all. */
const INVITE_THE_BOT = 'このチャンネルに bot を招待してください。';

// The fake GROWI's `refusals()` only records refusals of proxy-to-GROWI
// traffic, so it would stay empty for both cases below and prove nothing (task
// 11.2's hand-off (c) asks for that check on the GROWI-bound direction, not
// this one). Instead these tests check the response is 200 -- a rejected
// signature returns a bodyless 401, and reading `outcomes` after that would be
// inspecting an error response rather than a result.
describe('a notification from GROWI, end to end', () => {
  it('posts one notification to every destination the request names', async () => {
    // Nothing is scripted on either fake: a notification never reaches out to
    // GROWI, and every destination is meant to succeed here.
    const growi = await openGrowi();
    const chat = createFakeChatService();

    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');
    const second = await addChannel(db, workspace.installationId, 'slack');
    // Without this every destination is answered `inventory-not-ready`,
    // whatever the inventory holds.
    await markInventoryReady(db, workspace.installationId);
    const relationId = await pairGrowi(
      db,
      workspace.installationId,
      growi,
      'GROWI A',
    );
    await trustGrowiSignature(db, relationId, growi);

    const listener = await startOneProxy(chat);
    const answer = await growi.callProxy(await listener.baseUrl(), {
      relationId,
      op: OP_NAMES.notification,
      body: {
        requestId: `req-${randomUUID()}`,
        targets: [
          { platform: 'slack', channelId: workspace.channel.channelId },
          { platform: 'slack', channelId: second.channelId },
        ],
        markdown: NOTIFICATION_MARKDOWN,
        containsRestrictedPage: false,
      },
    });

    // A 200 says the signature was accepted: a refused one comes back 401 with
    // no body at all, which would leave the outcome assertions below reading
    // an error page rather than a result.
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      outcomes: [
        {
          platform: 'slack',
          channelId: workspace.channel.channelId,
          status: 'posted',
        },
        { platform: 'slack', channelId: second.channelId, status: 'posted' },
      ],
    });

    // Both channels, the notification's own text, and visible to the channel
    // rather than to one person.
    expect(
      chat.posts().map((post) => [post.kind, post.channel.channelId]),
    ).toEqual([
      ['post', workspace.channel.channelId],
      ['post', second.channelId],
    ]);
    expect(chat.posts().map(markdownOf)).toEqual([
      NOTIFICATION_MARKDOWN,
      NOTIFICATION_MARKDOWN,
    ]);
  });

  it('re-posts only where the first attempt failed, and tells the operator how to fix it', async () => {
    const growi = await openGrowi();

    // The first attempt on the second channel fails as 「bot が招待されていな
    // い」 -- Requirement 2.4's case, and the only status `post()` alone can
    // report. A flag rather than a count read from `posts()`: the fake records
    // a post BEFORE asking this function what it answers, so a condition
    // derived from `posts()` would already be counting the in-flight one.
    let botInvited = false;
    let failingChannelId = '';
    const chat = createFakeChatService({
      post: (post): PostOutcome => {
        if (post.channel.channelId === failingChannelId && !botInvited) {
          return {
            ok: false,
            reason: 'bot-not-in-channel',
            remedy: INVITE_THE_BOT,
          };
        }
        return { ok: true, messageId: `message-${randomUUID()}` };
      },
    });

    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');
    const second = await addChannel(db, workspace.installationId, 'slack');
    failingChannelId = second.channelId;
    await markInventoryReady(db, workspace.installationId);
    const relationId = await pairGrowi(
      db,
      workspace.installationId,
      growi,
      'GROWI A',
    );
    await trustGrowiSignature(db, relationId, growi);

    const listener = await startOneProxy(chat);
    const proxyBaseUrl = await listener.baseUrl();
    // The SAME request id both times: that is what makes the second call a
    // retry of the first rather than a new notification, and it is the id the
    // per-destination record (`processed_notification_target`) is keyed by.
    const requestId = `req-${randomUUID()}`;
    const notification = {
      relationId,
      op: OP_NAMES.notification,
      body: {
        requestId,
        targets: [
          { platform: 'slack', channelId: workspace.channel.channelId },
          { platform: 'slack', channelId: second.channelId },
        ],
        markdown: NOTIFICATION_MARKDOWN,
        containsRestrictedPage: false,
      },
    } as const;

    const first = await growi.callProxy(proxyBaseUrl, notification);

    expect(first.status).toBe(200);
    // Requirement 2.4: 対象のチャンネル (the destination is named), 投稿できな
    // かったこと (the status), and 必要な操作 (the remedy, verbatim -- the
    // proxy does not rewrite what the chat service said to do).
    expect(first.body).toEqual({
      outcomes: [
        {
          platform: 'slack',
          channelId: workspace.channel.channelId,
          status: 'posted',
        },
        {
          platform: 'slack',
          channelId: second.channelId,
          status: 'bot-not-in-channel',
          remedy: INVITE_THE_BOT,
        },
      ],
    });

    // The operator invites the bot and GROWI retries the same notification.
    botInvited = true;
    const retry = await growi.callProxy(proxyBaseUrl, notification);

    // Two assertions, kept apart on purpose (the same split Implementation
    // Note 7.3 made for the unit-level version): rolled into one, 「成功した
    // 宛先へ投稿し直した」 and 「今回試した宛先しか答えなかった」 would each
    // hide the other.
    //
    // (1) The destination that already succeeded is not posted to a second
    //     time; the one that failed is.
    expect(retry.status).toBe(200);
    expect(postsTo(chat, workspace.channel.channelId)).toHaveLength(1);
    expect(postsTo(chat, second.channelId)).toHaveLength(2);

    // (2) The answer still covers the WHOLE of the original target list, with
    //     the earlier success reported as such -- GROWI writes this straight
    //     back into its outbox row, and an answer naming only what was tried
    //     this time would erase it.
    expect(retry.body).toEqual({
      outcomes: [
        {
          platform: 'slack',
          channelId: workspace.channel.channelId,
          status: 'posted',
        },
        { platform: 'slack', channelId: second.channelId, status: 'posted' },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// 紐付け (Requirement 7.6)
// ---------------------------------------------------------------------------

const GROWI_LABEL = 'GROWI A';
const LINK_URL = 'http://growi-a.test/chat-link/one-time-token';

/** GROWI refuses a write by an account it does not know yet (Req 7.6). */
const refusesUntilLinked = () => ({
  body: {
    kind: 'account-link-required',
    growiLabel: GROWI_LABEL,
    linkUrl: LINK_URL,
  },
});

/** The same GROWI answering `link`, typed by the user of their own accord. */
const issuesLink = () => ({
  body: {
    status: 'link-issued',
    linkUrl: LINK_URL,
    expiresAt: '2026-09-01T00:10:00.000Z',
  },
});

/**
 * Runs `create-page` on Slack up to the point GROWI answers. Slack takes the
 * values in a modal (`modal: full`), and with one paired GROWI there is no
 * 「どの GROWI か」 question -- the command runs straight away.
 */
const runWriteCommand = async (
  chat: FakeChatService,
  workspace: Workspace,
): Promise<void> => {
  const mentioned = await chat.deliver(
    mentionOn('slack', {
      text: '@growi create-page',
      channel: workspace.channel,
      actor: workspace.actor,
    }),
  );
  expect(mentioned).toEqual({ handled: true });

  const [modal, ...rest] = chat.modals();
  if (modal == null || rest.length > 0) {
    throw new Error(`expected exactly one modal, got ${chat.modals().length}`);
  }
  const submitted = await chat.deliver(
    modalSubmitOn('slack', {
      channel: workspace.channel,
      actor: workspace.actor,
      correlationId: modal.correlationId,
      values: { path: '/e2e/linking', body: 'written from the channel' },
    }),
  );
  expect(submitted).toEqual({ handled: true });
};

describe('the account-linking flow, end to end', () => {
  it('answers an unlinked user’s write only to them, with the way out named', async () => {
    const growi = await openGrowi({
      responders: { [OP_NAMES.command]: refusesUntilLinked },
    });
    const chat = createFakeChatService();

    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');
    const relationId = await pairGrowi(
      db,
      workspace.installationId,
      growi,
      GROWI_LABEL,
    );
    // Without this the write is stopped by channel permission (`no-settings`)
    // and never reaches GROWI, so the refusal under test would never be asked
    // for.
    await permitWrite(db, relationId, workspace.channel.channelId);

    await startOneProxy(chat);
    await runWriteCommand(chat, workspace);

    // The command really did travel to GROWI and was really refused there --
    // no refusal of the SIGNATURE, which would leave `received()` empty and
    // make an empty channel look like a link notice that never came.
    expect(growi.refusals()).toEqual([]);
    expect(growi.received().map((request) => request.op)).toEqual([
      OP_NAMES.command,
    ]);

    // Requirement 7.6: the operation did not run, and what came back names
    // which GROWI the link is for and where to go.
    const notice = onlyEphemeral(chat);
    expect(notice.user).toEqual(workspace.actor);
    expect(markdownOf(notice)).toContain(GROWI_LABEL);
    expect(markdownOf(notice)).toContain(LINK_URL);

    // Nobody else in the channel sees it. The link is one-time and short-lived,
    // so a channel-visible copy would be usable by whoever read it first.
    expect(chat.posts().filter((post) => post.kind === 'post')).toEqual([]);
  });

  it('reaches the same one notice when the user types `link` instead', async () => {
    const growi = await openGrowi({
      responders: {
        [OP_NAMES.command]: refusesUntilLinked,
        [OP_NAMES.accountLinkStart]: issuesLink,
      },
    });
    const chat = createFakeChatService();

    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');
    // The label is the fixture's, and `refusesUntilLinked` answers with the
    // same one: the refusal carries GROWI's own wording while `link` reads the
    // stored relation, so the two only compare as equal when the stored label
    // and the answered one agree -- as they do for a real pair.
    const relationId = await pairGrowi(
      db,
      workspace.installationId,
      growi,
      GROWI_LABEL,
    );
    await permitWrite(db, relationId, workspace.channel.channelId);

    await startOneProxy(chat);

    // Entrance 1: a write GROWI refuses.
    await runWriteCommand(chat, workspace);
    const fromRefusal = onlyEphemeral(chat);

    // Entrance 2: the user asks to link, of their own accord. `link` offers the
    // choice even with a single GROWI -- the user is picking which identity to
    // tie, not which GROWI an operation lands on.
    const typed = await chat.deliver(
      mentionOn('slack', {
        text: '@growi link',
        channel: workspace.channel,
        actor: workspace.actor,
      }),
    );
    expect(typed).toEqual({ handled: true });

    const choice = lastChoice(chat);
    expect(choice.options.map((option) => option.id)).toEqual([relationId]);
    const pressed = await chat.deliver(
      actionOn('slack', {
        channel: workspace.channel,
        actor: workspace.actor,
        correlationId: choice.correlationId,
        actionId: relationId,
      }),
    );
    expect(pressed).toEqual({ handled: true });

    expect(growi.refusals()).toEqual([]);
    expect(growi.received().map((request) => request.op)).toEqual([
      OP_NAMES.command,
      OP_NAMES.accountLinkStart,
    ]);

    // The convergence itself: two different entrances, one rendering and one
    // way of delivering it. Compared as whole messages rather than by
    // searching for the URL in each -- 「同じ経路」 means the user reads the
    // same thing, not merely that both mentioned the link somewhere.
    //
    // The last ephemeral, not the second: asking 「どの GROWI か」 is itself
    // sent that way (`ArgumentCollector` may only `openModal` or
    // `postEphemeral`), so the choice sits between the two notices.
    const ephemerals = chat.posts().filter((post) => post.kind === 'ephemeral');
    expect(ephemerals.map((post) => post.message.kind)).toEqual([
      'markdown',
      'choice',
      'markdown',
    ]);
    const fromTyping = ephemerals.at(-1);
    if (fromTyping == null) throw new Error('the proxy posted nothing at all');
    expect(fromTyping.message).toEqual(fromRefusal.message);
    expect(fromTyping.user).toEqual(workspace.actor);
    // Pin the equal messages to the real link-guidance content too, so this
    // test cannot pass because both entrances happened to fail identically.
    expect(markdownOf(fromTyping)).toContain(LINK_URL);
  });
});
