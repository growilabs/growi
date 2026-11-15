// `PlatformFacade.fetchConversation` through the real facade, on Mattermost
// with two installations open: the read goes to the installation named, reads
// the thread or the channel's latest posts, and leaves out the bot's own posts
// and the request. Mattermost is the service connected per installation, so
// it is where naming the wrong installation would read someone else's server.
import { randomUUID } from 'node:crypto';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type {
  InstallationCredentials,
  PlatformAppConfig,
  SdkChannelRef,
} from '../types/index.js';
import { BOT_USER_NAME } from './bot-factory.js';
import {
  type ChatServiceStandIn,
  catchEvents,
  type StandInReply,
  startChatServiceStandIn,
} from './chat-service-stand-in.js';
import { createPlatformFacade, type PlatformFacade } from './index.js';
import type { InstallationProvider } from './installation-provider.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const APP_CONFIG: PlatformAppConfig = {
  stateConnectionString:
    process.env.CHAT_SDK_DATABASE_URL ??
    `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`,
};

const CHANNEL = 'channelinb00000000000000000';
const ROOT = 'rootpost000000000000000000';
const REQUEST = 'requestpost000000000000000';
const ALICE = 'aliceuserid000000000000000';
const BOB = 'bobuserid00000000000000000';

const post = (id: string, userId: string, at: number, message: string) => ({
  id,
  create_at: at,
  edit_at: 0,
  user_id: userId,
  channel_id: CHANNEL,
  root_id: id === ROOT ? '' : ROOT,
  message,
});

/** Mattermost's post list: ids in `order` (newest first), posts by id. */
const postList = (
  posts: ReadonlyArray<ReturnType<typeof post>>,
  extra: Record<string, unknown> = {},
) => ({
  order: [...posts].reverse().map((p) => p.id),
  posts: Object.fromEntries(posts.map((p) => [p.id, p])),
  ...extra,
});

const startMattermost = async (
  botUserId: string,
  answer: (path: string) => StandInReply | undefined = () => undefined,
) =>
  await startChatServiceStandIn(({ path }) => {
    const answered = answer(path);
    if (answered != null) return answered;
    if (path === '/api/v4/users/me') {
      return { body: { id: botUserId, username: BOT_USER_NAME } };
    }
    const user = /^\/api\/v4\/users\/(\w+)$/.exec(path)?.[1];
    if (user != null) {
      return {
        body: { id: user, username: user, first_name: user.slice(0, 5) },
      };
    }
    const threadPosts = [
      post(ROOT, ALICE, 1_000, 'shall we ship?'),
      post('replyfrombob00000000000000', BOB, 2_000, 'after QA'),
      post('replyfrombot00000000000000', botUserId, 3_000, 'a bot reply'),
      post(REQUEST, ALICE, 4_000, '@growi agent summarize'),
    ];
    if (path === `/api/v4/posts/${ROOT}/thread`) {
      return { body: postList(threadPosts) };
    }
    // Routed by path alone, as a real server routes it.
    if (
      new URL(path, 'http://stand-in').pathname ===
      `/api/v4/channels/${CHANNEL}/posts`
    ) {
      return { body: postList(threadPosts, { has_next: true }) };
    }
    return { status: 404, body: { message: 'not found' } };
  });

describe('fetchConversation on Mattermost, with two installations open', () => {
  let facade: PlatformFacade;
  let serverA: ChatServiceStandIn;
  let serverB: ChatServiceStandIn;
  const installationA = randomUUID();
  const installationB = randomUUID();

  const open = async (
    answerB?: (path: string) => StandInReply | undefined,
  ): Promise<void> => {
    serverA = await startMattermost('botinstallationa0000000000');
    serverB = await startMattermost('botinstallationb0000000000', answerB);
    const credentialsOf: Record<string, InstallationCredentials> = {
      'team-a': { mattermost: { baseUrl: serverA.url, botToken: 'token-a' } },
      'team-b': { mattermost: { baseUrl: serverB.url, botToken: 'token-b' } },
    };
    const installations = mock<InstallationProvider>({
      list: async (platform) =>
        platform === 'mattermost'
          ? [
              { installationId: installationA, workspaceId: 'team-a' },
              { installationId: installationB, workspaceId: 'team-b' },
            ]
          : [],
      resolve: async (platform, workspaceId) =>
        platform === 'mattermost' ? (credentialsOf[workspaceId] ?? null) : null,
    });
    facade = await createPlatformFacade(
      APP_CONFIG,
      installations,
      catchEvents().sink,
    );
    await facade.connections().reconcile();
  };

  afterEach(async () => {
    await facade.shutdown();
    await Promise.all([serverA.close(), serverB.close()]);
  });

  const channel = (): SdkChannelRef => ({
    platform: 'mattermost',
    channelId: toSdkChannelId('mattermost', CHANNEL),
    channelName: 'town-square',
    isPrivate: false,
  });

  const readPaths = (server: ChatServiceStandIn) =>
    server.requests
      .map((request) => request.path)
      .filter((path) => path.includes('/posts'));

  it("reads the request's thread through the installation named, without the bot's posts or the request", async () => {
    await open();

    const outcome = await facade.fetchConversation(
      channel(),
      { threadRootId: ROOT, requestMessageId: REQUEST, limit: 200 },
      { installationId: installationB },
    );

    expect(outcome).toEqual({
      ok: true,
      truncated: false,
      messages: [
        {
          postedAt: new Date(1_000).toISOString(),
          author: {
            platform: 'mattermost',
            accountId: ALICE,
            displayName: 'alice',
          },
          text: 'shall we ship?',
        },
        {
          postedAt: new Date(2_000).toISOString(),
          author: {
            platform: 'mattermost',
            accountId: BOB,
            displayName: 'bobus',
          },
          text: 'after QA',
        },
      ],
    });
    expect(readPaths(serverB)).toEqual([`/api/v4/posts/${ROOT}/thread`]);
    expect(readPaths(serverA)).toEqual([]);
  });

  // chat-adapter-mattermost 1.1.3 assigns the query to `URL.pathname`, which
  // percent-encodes the `?`, so no server routes this read. Starts passing,
  // and must lose `.fails`, once the adapter sends a real query.
  it.fails("reads the channel's latest posts when the request is not in a thread, and says older ones remain", async () => {
    await open();

    const outcome = await facade.fetchConversation(
      channel(),
      { threadRootId: null, requestMessageId: REQUEST, limit: 200 },
      { installationId: installationB },
    );

    expect(outcome).toMatchObject({ ok: true, truncated: true });
    expect(outcome.ok && outcome.messages.map((m) => m.text)).toEqual([
      'shall we ship?',
      'after QA',
    ]);
    expect(readPaths(serverB)).toEqual([
      `/api/v4/channels/${CHANNEL}/posts?page=0&per_page=200`,
    ]);
  });

  it('answers not-in-channel when the server refuses the bot', async () => {
    await open((path) =>
      path === `/api/v4/posts/${ROOT}/thread`
        ? { status: 403, body: { message: 'no access' } }
        : undefined,
    );

    const outcome = await facade.fetchConversation(
      channel(),
      { threadRootId: ROOT, requestMessageId: null, limit: 200 },
      { installationId: installationB },
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'not-in-channel',
      remedy: expect.any(String),
    });
  });

  it('refuses, reading nothing, when no open connection serves the installation named', async () => {
    await open();

    await expect(
      facade.fetchConversation(
        channel(),
        { threadRootId: null, requestMessageId: null, limit: 200 },
        { installationId: randomUUID() },
      ),
    ).rejects.toThrow();
    expect(readPaths(serverA)).toEqual([]);
    expect(readPaths(serverB)).toEqual([]);
  });
});
