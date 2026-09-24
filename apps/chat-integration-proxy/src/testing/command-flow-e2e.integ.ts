// Task 11.2 -- the command flow, driven end to end on all four services
// against a real PostgreSQL.
//
// **This file is EXPECTED to be red in this devcontainer**, for the same
// reason `harness-round-trip.integ.ts` is: the `postgres` hostname does not
// resolve here (Implementation Note 1.2). That is not a defect of this task.
// There is deliberately no `beforeAll` -- a failing `beforeAll` SKIPS the
// bodies, so not one assertion below would ever be parsed while storage is
// unreachable, and a mistake in them would stay hidden long after this task
// closed.
//
// What is checked here, and nowhere else, is the WHOLE path: a real
// `startProxy` boot with real Prisma behind it, a chat event injected at the
// facade, the real `orchestration/` -> `command/` -> `relation/` -> `growi/`
// graph, and a signed HTTP round trip to a fake GROWI that verifies the
// signature with `@growi/chat`'s own `verify()`. The per-step branching of
// each flow is already owned by `orchestration/command-flow.spec.ts` and
// `command/argument-collector.spec.ts`; what is asserted below is only what
// an end user would observe -- a modal opened, a page created at the path
// they typed, a link posted back, results labelled with the GROWI they came
// from.
//
// **Which service exercises which flow is read from the capability table**
// (`capabilities/platform-capabilities.ts`), never assumed from a service
// name:
//
//  - `modal: full` -> Slack and Teams: the values are taken in an input field.
//  - `modal: none` -> Discord and Mattermost: the values are taken by
//    follow-up questions answered by addressing the bot.
//  - `interactiveActions: full` -> Slack, Discord and Teams: 「どの GROWI
//    か」 comes back as a pressed button (an `action` event).
//  - `interactiveActions: none` -> Mattermost alone: the same question is
//    rendered as a numbered list and answered by POSITION.
//
// The rendering of that numbered list belongs to `platform/outbound.ts` and is
// covered by its own spec; this harness stands in for the facade, so what it
// can prove -- and what actually matters to a user on Mattermost -- is that
// the position they typed selects the GROWI that was offered in that position.

import { COMMAND_NAMES, OP_NAMES } from '@growi/chat';
import { afterEach, describe, expect, it } from 'vitest';

import { levelOf } from '../capabilities/index.js';
import { createPrismaClient, type PrismaClient } from '../db/index.js';
import type { ProxyConfig } from '../runtime/index.js';
import type { OutboundMessage } from '../types/index.js';
import { actionOn, mentionOn, modalSubmitOn } from './chat-events.js';
import type { CapturedPost, FakeChatService } from './fake-chat-service.js';
import { createFakeChatService } from './fake-chat-service.js';
import type { OpResponder } from './fake-growi.js';
import { startFakeGrowi } from './fake-growi.js';
import type { FreePortListener } from './free-port.js';
import { LOOPBACK, listenOnFreePort } from './free-port.js';
import {
  openWorkspace,
  pairGrowi,
  passthroughCipher,
  permitWrite,
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

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const openDb = (): PrismaClient => {
  const db = createPrismaClient(DATABASE_URL);
  closers.push(() => db.$disconnect());
  return db;
};

/**
 * The rows every case below needs are built by `paired-workspace.ts`: task
 * 11.2 wrote them here, and 11.3 moved them there when a second file came to
 * need them (Implementation Note 11.2 (a)). `trustGrowiSignature` is not among
 * the ones used here -- all four flows travel proxy -> GROWI, and nothing in
 * this file signs its way INTO the proxy.
 */
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

// ---------------------------------------------------------------------------
// What the fake GROWIs answer
// ---------------------------------------------------------------------------

/** Shaped to pass `parseCommandResponse`; a gap here reads as a flow failure. */
const createsPageAt =
  (pageUrl: string): OpResponder =>
  () => ({
    body: { kind: 'created', pageUrl },
  });

const findsOnePage =
  (title: string, url: string): OpResponder =>
  () => ({
    body: {
      kind: 'search',
      items: [
        {
          rank: 1,
          path: '/e2e/minutes',
          title,
          url,
          updatedAt: '2026-09-01T00:00:00.000Z',
          commentCount: 0,
        },
      ],
      appliedAs: 'anonymous',
    },
  });

// ---------------------------------------------------------------------------
// Reading what the proxy sent back
// ---------------------------------------------------------------------------

const lastPost = (chat: FakeChatService): CapturedPost => {
  const post = chat.posts().at(-1);
  if (post == null) throw new Error('the proxy posted nothing at all');
  return post;
};

const onlyModal = (chat: FakeChatService) => {
  const [modal, ...rest] = chat.modals();
  if (modal == null || rest.length > 0) {
    throw new Error(`expected exactly one modal, got ${chat.modals().length}`);
  }
  return modal;
};

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

const lastList = (
  chat: FakeChatService,
): Extract<OutboundMessage, { kind: 'list' }> => {
  const list = chat
    .posts()
    .flatMap((post) => (post.message.kind === 'list' ? [post.message] : []))
    .at(-1);
  if (list == null) throw new Error('the proxy posted no list');
  return list;
};

const markdownOf = (post: CapturedPost): string =>
  post.message.kind === 'markdown' ? post.message.markdown : '';

// ---------------------------------------------------------------------------
// The four services
// ---------------------------------------------------------------------------

describe('a command run end to end', () => {
  it('takes a Slack user from a mention through an input field and a button to a created page whose link is posted', async () => {
    // Slack: `modal: full` and `interactiveActions: full` -- the input field
    // AND the button are both available here.
    expect(levelOf('modal', 'slack')).toBe('full');

    const growiA = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: createsPageAt('http://growi-a.test/e2e/slack'),
      },
    });
    const growiB = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: createsPageAt('http://growi-b.test/e2e/slack'),
      },
    });
    closers.push(growiA.close, growiB.close);

    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');
    const relationA = await pairGrowi(
      db,
      workspace.installationId,
      growiA,
      'GROWI A',
    );
    const relationB = await pairGrowi(
      db,
      workspace.installationId,
      growiB,
      'GROWI B',
    );
    await permitWrite(db, relationA, workspace.channel.channelId);
    await permitWrite(db, relationB, workspace.channel.channelId);

    const chat = createFakeChatService();
    await startOneProxy(chat);

    // 呼びかけ -- with no arguments, so the values have to be asked for.
    const mentioned = await chat.deliver(
      mentionOn('slack', {
        text: '@growi create-page',
        channel: workspace.channel,
        actor: workspace.actor,
      }),
    );
    expect(mentioned).toEqual({ handled: true });

    // 入力欄 (Requirement 4.1): the path and the body, asked for together.
    const modal = onlyModal(chat);
    expect(modal.form.fields.map((field) => field.name)).toEqual([
      'path',
      'body',
    ]);

    const submitted = await chat.deliver(
      modalSubmitOn('slack', {
        channel: workspace.channel,
        actor: workspace.actor,
        correlationId: modal.correlationId,
        values: { path: '/e2e/slack', body: 'decided in the channel' },
      }),
    );
    expect(submitted).toEqual({ handled: true });

    // ボタン (Requirement 8.2): two GROWIs are paired, so which one is asked.
    const choice = lastChoice(chat);
    expect(choice.options.map((option) => option.label)).toEqual([
      'GROWI A',
      'GROWI B',
    ]);
    expect(choice.options.map((option) => option.id)).toEqual([
      relationA,
      relationB,
    ]);

    const pressed = await chat.deliver(
      actionOn('slack', {
        channel: workspace.channel,
        actor: workspace.actor,
        correlationId: choice.correlationId,
        actionId: relationA,
      }),
    );
    expect(pressed).toEqual({ handled: true });

    // ページ作成 (Requirement 4.2) -- at the chosen GROWI, and nowhere else.
    expect(growiA.received().map((request) => request.body)).toEqual([
      expect.objectContaining({
        op: OP_NAMES.command,
        kind: COMMAND_NAMES.createPage,
        path: '/e2e/slack',
        body: 'decided in the channel',
        // Requirement 4.3: the page's author is decided by the actor GROWI is
        // told about, so the actor travelling on the envelope is the whole of
        // what this side can prove about it.
        actor: expect.objectContaining({
          accountId: workspace.actor.accountId,
        }),
      }),
    ]);
    expect(growiB.received()).toEqual([]);
    // A signature the fake GROWI turned down would leave `received()` empty
    // too; this tells a refused request apart from a flow that never ran.
    expect(growiA.refusals()).toEqual([]);

    // リンクが投稿される -- in the channel, not privately: a new page is the
    // outcome of a conversation happening there.
    const answer = lastPost(chat);
    expect(answer.kind).toBe('post');
    expect(markdownOf(answer)).toContain('http://growi-a.test/e2e/slack');
  });

  it('takes a Mattermost user through follow-up questions and a numbered choice answered by position', async () => {
    // Mattermost is the one service with NEITHER an input field NOR pressable
    // buttons, which is what puts both substitutes on the same path here.
    expect(levelOf('modal', 'mattermost')).toBe('none');
    expect(levelOf('interactiveActions', 'mattermost')).toBe('none');

    const growiA = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: createsPageAt('http://growi-a.test/e2e/mm'),
      },
    });
    const growiB = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: createsPageAt('http://growi-b.test/e2e/mm'),
      },
    });
    closers.push(growiA.close, growiB.close);

    const db = openDb();
    const workspace = await openWorkspace(db, 'mattermost');
    const relationA = await pairGrowi(
      db,
      workspace.installationId,
      growiA,
      'GROWI A',
    );
    const relationB = await pairGrowi(
      db,
      workspace.installationId,
      growiB,
      'GROWI B',
    );
    await permitWrite(db, relationA, workspace.channel.channelId);
    await permitWrite(db, relationB, workspace.channel.channelId);

    const chat = createFakeChatService();
    await startOneProxy(chat);

    const say = async (text: string): Promise<void> => {
      const outcome = await chat.deliver(
        mentionOn('mattermost', {
          text,
          channel: workspace.channel,
          actor: workspace.actor,
        }),
      );
      expect(outcome).toEqual({ handled: true });
    };

    // 呼びかけ -> 聞き返し (Requirement 1.2's substitute for a missing input
    // field). Nothing is asked in a modal here, and that is the point.
    await say('@growi create-page');
    expect(chat.modals()).toEqual([]);
    expect(lastPost(chat).kind).toBe('ephemeral');
    expect(markdownOf(lastPost(chat))).toContain('Path');

    // The answers arrive by addressing the bot again -- `plainReply` is
    // unverified on every service, so a reply is never what carries them.
    await say('@growi /e2e/mattermost');
    expect(markdownOf(lastPost(chat))).toContain('Body');

    await say('@growi minutes of the release meeting');

    // 番号つき一覧 (Requirement 8.2 on a service with no buttons). The order
    // the options are offered in IS the contract: the reader answers with a
    // position, and nothing else identifies the GROWI they meant.
    const choice = lastChoice(chat);
    expect(choice.options.map((option) => option.id)).toEqual([
      relationA,
      relationB,
    ]);

    await say('@growi 2');

    // The second option, and only it, was acted on.
    expect(growiB.received().map((request) => request.body)).toEqual([
      expect.objectContaining({
        kind: COMMAND_NAMES.createPage,
        path: '/e2e/mattermost',
        body: 'minutes of the release meeting',
        // Requirement 4.3: the page's author is decided by the actor GROWI is
        // told about, so the actor travelling on the envelope is the whole of
        // what this side can prove about it.
        actor: expect.objectContaining({
          accountId: workspace.actor.accountId,
        }),
      }),
    ]);
    expect(growiA.received()).toEqual([]);
    expect(growiB.refusals()).toEqual([]);
    expect(markdownOf(lastPost(chat))).toContain('http://growi-b.test/e2e/mm');
  });

  it('answers a Discord search with both GROWIs’ results, each row saying which GROWI it came from', async () => {
    const growiA = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: findsOnePage(
          'Release notes',
          'http://growi-a.test/e2e/minutes',
        ),
      },
    });
    const growiB = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: findsOnePage(
          'Retrospective',
          'http://growi-b.test/e2e/minutes',
        ),
      },
    });
    closers.push(growiA.close, growiB.close);

    const db = openDb();
    const workspace = await openWorkspace(db, 'discord');
    await pairGrowi(db, workspace.installationId, growiA, 'GROWI A');
    await pairGrowi(db, workspace.installationId, growiB, 'GROWI B');
    // No `channel_permission` row on purpose -- `search` reads, and a read
    // command with no stored settings is permitted (`judge`'s default).

    const chat = createFakeChatService();
    await startOneProxy(chat);

    // The whole command fits on one line, so nothing is asked and the search
    // goes out at once (Requirement 3.1).
    const outcome = await chat.deliver(
      mentionOn('discord', {
        text: '@growi search minutes',
        channel: workspace.channel,
        actor: workspace.actor,
      }),
    );
    expect(outcome).toEqual({ handled: true });

    expect(growiA.received().map((request) => request.body)).toEqual([
      expect.objectContaining({
        kind: COMMAND_NAMES.search,
        keyword: 'minutes',
      }),
    ]);
    expect(growiA.refusals()).toEqual([]);
    expect(growiB.received().map((request) => request.body)).toEqual([
      expect.objectContaining({
        kind: COMMAND_NAMES.search,
        keyword: 'minutes',
      }),
    ]);
    expect(growiB.refusals()).toEqual([]);

    // One list, carrying both GROWIs (Requirement 3.2), every row attributed
    // to the GROWI it came from (Requirement 3.3). The ORDER the two are
    // interleaved in belongs to `growi/search-fusion.ts` and is asserted by
    // its own spec, so it is read as a set here.
    const list = lastList(chat);
    expect(
      list.rows.map((row) => ({
        sourceLabel: row.sourceLabel,
        hasUrl: row.markdown.includes(
          row.sourceLabel === 'GROWI A'
            ? 'http://growi-a.test/e2e/minutes'
            : 'http://growi-b.test/e2e/minutes',
        ),
      })),
    ).toEqual(
      expect.arrayContaining([
        { sourceLabel: 'GROWI A', hasUrl: true },
        { sourceLabel: 'GROWI B', hasUrl: true },
      ]),
    );
    expect(list.rows).toHaveLength(2);

    // The answer replaces the 「検索しています…」 placeholder rather than
    // being posted underneath it.
    expect(lastPost(chat).kind).toBe('replace');
  });

  it('runs the whole flow on Teams -- an input field, and the one inbound route this proxy opens', async () => {
    // The combination that makes Teams worth checking on its own: it CAN take
    // the values in an input field despite being the one service reached
    // inbound rather than by connecting out. (Task 12.2: every service now
    // reports `slashCommand: 'none'`, since command/invocation.ts does not
    // yet recognize one on any of them -- Teams no longer stands out on that
    // axis, only on modal support plus inbound reachability.)
    // `platform-capabilities.spec.ts` owns the table itself; this is the
    // premise the rest of this case rests on.
    expect(levelOf('slashCommand', 'teams')).toBe('none');
    expect(levelOf('modal', 'teams')).toBe('full');

    const growi = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: createsPageAt('http://growi-a.test/e2e/teams'),
      },
    });
    closers.push(growi.close);

    const db = openDb();
    const workspace = await openWorkspace(db, 'teams');
    const relationId = await pairGrowi(
      db,
      workspace.installationId,
      growi,
      'GROWI A',
    );
    await permitWrite(db, relationId, workspace.channel.channelId);

    const chat = createFakeChatService();
    const listener = await startOneProxy(chat);

    // 呼びかけ alone starts the command -- there is no slash command to fall
    // back on here (Requirement 1.2).
    const mentioned = await chat.deliver(
      mentionOn('teams', {
        text: '@growi create-page',
        channel: workspace.channel,
        actor: workspace.actor,
      }),
    );
    expect(mentioned).toEqual({ handled: true });

    const modal = onlyModal(chat);
    await chat.deliver(
      modalSubmitOn('teams', {
        channel: workspace.channel,
        actor: workspace.actor,
        correlationId: modal.correlationId,
        values: { path: '/e2e/teams', body: 'agreed in the meeting' },
      }),
    );

    // One GROWI is paired, so nothing is asked about which one (Requirement
    // 8.3) and the page is created straight away.
    expect(chat.posts().some((post) => post.message.kind === 'choice')).toBe(
      false,
    );
    expect(growi.received().map((request) => request.body)).toEqual([
      expect.objectContaining({
        kind: COMMAND_NAMES.createPage,
        path: '/e2e/teams',
        body: 'agreed in the meeting',
        // Requirement 4.3: the page's author is decided by the actor GROWI is
        // told about, so the actor travelling on the envelope is the whole of
        // what this side can prove about it.
        actor: expect.objectContaining({
          accountId: workspace.actor.accountId,
        }),
      }),
    ]);
    expect(growi.refusals()).toEqual([]);
    expect(markdownOf(lastPost(chat))).toContain(
      'http://growi-a.test/e2e/teams',
    );

    // Teams is also the one service that dials THIS proxy. Requirement 13.2:
    // a route is opened for it and for nothing else, so a service that needs
    // no inbound hole has none to find.
    const baseUrl = await listener.baseUrl();
    const forTeams = await fetch(`${baseUrl}/webhook/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(forTeams.status).toBe(200);
    expect(chat.webhookCalls()).toEqual(['teams']);

    const forSlack = await fetch(`${baseUrl}/webhook/slack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(forSlack.status).toBe(404);
  });
});
