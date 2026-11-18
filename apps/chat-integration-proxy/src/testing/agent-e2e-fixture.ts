// One Slack workspace paired with one fake GROWI that accepts every `agent`
// request, behind a real `startProxy` boot -- the setup the three `agent`
// user-flow suites share.
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// The proxy is the production graph (`createProxyDependencies` via
// `startProxy`): only the chat service is the fake facade. Both signing
// directions are set up, because an `agent` flow uses both -- the request goes
// out to GROWI, and the answer and the conversation request come back in.
//
// Every row is made under fresh ids and removed again by `close`, so a run
// shares nothing with another worker or an earlier run.

import { randomUUID } from 'node:crypto';
import { OP_NAMES } from '@growi/chat';

import { createPrismaClient, type PrismaClient } from '../db/index.js';
import type { ProxyConfig } from '../runtime/index.js';
import type { EventInstallation, SdkChannelRef } from '../types/index.js';
import { channelOn, sdkChannelIdOn } from './chat-events.js';
import {
  type CapturedPost,
  createFakeChatService,
  type FakeChatScript,
  type FakeChatService,
} from './fake-chat-service.js';
import {
  type FakeGrowi,
  type FakeGrowiRequest,
  startFakeGrowi,
} from './fake-growi.js';
import { LOOPBACK, listenOnFreePort } from './free-port.js';
import {
  openWorkspace,
  pairGrowi,
  passthroughCipher,
  permitAgent,
  removeWorkspace,
  trustGrowiSignature,
  type Workspace,
} from './paired-workspace.js';
import { type ProxyCluster, startProxyCluster } from './proxy-cluster.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

export const GROWI_LABEL = 'Team Wiki';

/** The line every answer starts with, naming the GROWI it came from. */
export const ANSWER_HEADER = `GROWI「${GROWI_LABEL}」からの答え:`;

export interface AgentE2eOptions {
  /**
   * Turns the Slack AI app view on, the way `SLACK_AGENT_VIEW` does, by
   * handing the setting to the proxy directly. The credentials are never
   * used: the chat side is the fake facade.
   */
  readonly agentView?: boolean;
  readonly chat?: FakeChatScript;
}

export interface AgentE2e {
  readonly workspace: Workspace;
  readonly relationId: string;
  readonly growi: FakeGrowi;
  readonly chat: FakeChatService;
  /** Where GROWI reaches this proxy. */
  readonly proxyBaseUrl: string;
  /** The bot's DM with the workspace's actor, as the event names it. */
  readonly directChannel: SdkChannelRef;
  /** What the Slack connection says about the workspace a DM event came from. */
  readonly installation: EventInstallation;
}

const proxyConfig = (agentView: boolean): ProxyConfig => ({
  platformApp: {
    stateConnectionString: CHAT_SDK_DATABASE_URL,
    ...(agentView
      ? {
          slack: {
            signingSecret: 'unused-signing-secret',
            clientId: 'unused-client-id',
            clientSecret: 'unused-client-secret',
            appToken: 'xapp-unused',
            agentView: true,
          },
        }
      : {}),
  },
  // Every fake GROWI listens on loopback (see `command-flow-e2e.integ.ts`).
  closedNetwork: { allowList: [LOOPBACK], trustedCaCertsFor: () => [] },
  cipher: passthroughCipher,
  databaseUrl: DATABASE_URL,
  http: { port: 0, bodyLimitBytes: 1024 * 1024 },
  mattermostInstallations: [],
});

/**
 * Starts and stops one paired Slack workspace per test. Call `close` from
 * `afterEach`: it stops the proxy and the fake GROWI, then deletes the rows
 * `start` made.
 */
export const agentE2eScope = () => {
  let cluster: ProxyCluster | null = null;
  let growi: FakeGrowi | null = null;
  let db: PrismaClient | null = null;
  let installationId: string | null = null;

  const start = async (options: AgentE2eOptions = {}): Promise<AgentE2e> => {
    const client = createPrismaClient(DATABASE_URL);
    db = client;
    const fakeGrowi = await startFakeGrowi({
      responders: {
        [OP_NAMES.command]: () => ({ body: { kind: 'accepted' } }),
      },
    });
    growi = fakeGrowi;

    const workspace = await openWorkspace(client, 'slack');
    // Kept before anything is paired: a failure half-way still cleans up.
    installationId = workspace.installationId;
    const relationId = await pairGrowi(
      client,
      workspace.installationId,
      fakeGrowi,
      GROWI_LABEL,
    );
    await trustGrowiSignature(client, relationId, fakeGrowi);
    await permitAgent(client, relationId, workspace.channel, {
      inDirectMessage: true,
    });

    const chat = createFakeChatService(options.chat);
    const listener = listenOnFreePort();
    cluster = await startProxyCluster([
      {
        name: 'only',
        config: proxyConfig(options.agentView ?? false),
        overrides: { listen: listener.listen, createFacade: chat.createFacade },
      },
    ]);

    return {
      workspace,
      relationId,
      growi: fakeGrowi,
      chat,
      proxyBaseUrl: await listener.baseUrl(),
      directChannel: channelOn('slack', {
        channelId: sdkChannelIdOn('slack', `D-${randomUUID()}`),
        channelName: '',
        isPrivate: true,
        isDirectMessage: true,
      }),
      installation: {
        kind: 'identified',
        installationId: workspace.installationId,
      },
    };
  };

  const close = async (): Promise<void> => {
    const client = db;
    const created = installationId;
    // The proxy first, so nothing it still holds touches rows being removed.
    // Each step runs even when an earlier one failed: the rows must not be
    // left behind because a socket would not close.
    const steps: ReadonlyArray<() => Promise<void> | undefined> = [
      () => cluster?.stopAll(),
      () => growi?.close(),
      () =>
        client == null || created == null
          ? undefined
          : removeWorkspace(client, created),
      () => client?.$disconnect(),
    ];
    cluster = null;
    growi = null;
    db = null;
    installationId = null;
    let firstFailure: unknown = null;
    for (const step of steps) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: the rows must be gone before the client is disconnected
        await step();
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (firstFailure != null) throw firstFailure;
  };

  return { start, close };
};

/** The `agent` requests GROWI received, in order. */
export const agentRequestsTo = (
  growi: FakeGrowi,
): ReadonlyArray<FakeGrowiRequest['body']> =>
  growi
    .received()
    .map((request) => request.body)
    .filter((body) => body.kind === 'agent');

/** The id GROWI answers with: the one the proxy sent its `n`-th `agent` request under. */
export const requestIdOf = (growi: FakeGrowi, n = 0): string => {
  const requestId = agentRequestsTo(growi)[n]?.requestId;
  if (typeof requestId !== 'string') {
    throw new Error(`GROWI received no agent request number ${n}`);
  }
  return requestId;
};

export const markdownOf = (post: CapturedPost): string =>
  post.message.kind === 'markdown' ? post.message.markdown : '';
