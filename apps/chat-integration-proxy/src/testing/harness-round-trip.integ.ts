// Task 11.1's acceptance line, against a real PostgreSQL: 「偽の GROWI と 1 往復
// でき、偽のチャットサービスからイベントが 1 本届く」.
//
// **This file is EXPECTED to be red in this devcontainer.** The `postgres`
// hostname does not resolve here (Implementation Note 1.2), and every
// `*.integ.ts` in this app is in the same position. It is not a defect to fix
// in this task.
//
// What is checked here, and nowhere else, is what genuinely needs storage: a
// real `startProxy` boot with real Prisma behind it, an injected chat event
// travelling through the real `orchestration/` graph, and a signed request from
// the fake GROWI answered by the real `signatureGuard` inside the running
// instance. The signature round trip in the OTHER direction (this proxy's real
// `GrowiClient` to the fake GROWI) needs no storage at all and is checked
// green, in this sandbox, by `fake-growi.spec.ts`.
//
// The connection strings are read from the environment the same way (and for
// the same reason) `db/repositories/storage-round-trip.integ.ts` reads them,
// with `.env.development`'s values as the default. There is deliberately no
// `beforeAll`: a failing `beforeAll` SKIPS the test bodies, so while `postgres`
// is unreachable not one assertion below would ever be parsed, and a mistake in
// them would stay hidden long after this task closed.

import { randomUUID } from 'node:crypto';
import { OP_NAMES } from '@growi/chat';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createInstallationRepository,
  createPeerKeyRepository,
  createPrismaClient,
  createRelationRepository,
} from '../db/index.js';
import type { ProxyConfig } from '../runtime/index.js';
import { mentionOn } from './chat-events.js';
import { createFakeChatService } from './fake-chat-service.js';
import { startFakeGrowi } from './fake-growi.js';
import { listenOnFreePort } from './free-port.js';
import { type ProxyCluster, startProxyCluster } from './proxy-cluster.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

/** A cipher that leaves values readable: what it protects is not under test. */
const passthroughCipher = {
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
};

const proxyConfig = (growiHostname: string): ProxyConfig => ({
  platformApp: { stateConnectionString: CHAT_SDK_DATABASE_URL },
  closedNetwork: {
    // Without this the fake GROWI is refused before a socket is opened: it is
    // plain http on a loopback address, which is exactly the shape Requirement
    // 13 has operators declare.
    allowList: [growiHostname],
    trustedCaCertsFor: () => [],
  },
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

describe('the harness end to end', () => {
  it('delivers one injected chat event through a running proxy and answers the user', async () => {
    const growi = await startFakeGrowi({});
    closers.push(growi.close);

    const chat = createFakeChatService();
    const listener = listenOnFreePort();
    cluster = await startProxyCluster([
      {
        name: 'only',
        config: proxyConfig(growi.hostname),
        overrides: { listen: listener.listen, createFacade: chat.createFacade },
      },
    ]);

    // `mentionOn`'s `text` is the mention's raw text, address token included
    // -- `CommandInvocation.normalize` strips the FIRST whitespace-delimited
    // token unconditionally as the address (`command/invocation.ts`), so a
    // bare `'help'` with no address prefix is consumed as the address itself,
    // leaving an empty command name that matches nothing. `'@growi help'` is
    // the shape every other mention-driven e2e test in this app uses.
    const outcome = await chat.deliver(
      mentionOn('slack', { text: '@growi help' }),
    );

    // The proxy has no relation for this channel, so what comes back says so --
    // and that it came back at all is the proof the event crossed the whole
    // graph rather than being swallowed at the facade. `deliver` is used rather
    // than `emit` so a flow that threw is told apart from one that answered
    // nothing, instead of both arriving as an empty posts() list.
    expect(outcome).toEqual({ handled: true });
    expect(chat.posts()).not.toEqual([]);
  });

  it('answers a signed request the fake GROWI makes into the running proxy', async () => {
    const growi = await startFakeGrowi({});
    closers.push(growi.close);

    const db = createPrismaClient(DATABASE_URL);
    closers.push(() => db.$disconnect());

    const installations = createInstallationRepository(db, passthroughCipher);
    const installationId = await installations.save(
      'slack',
      `T-${randomUUID()}`,
      'harness workspace',
      { slack: { botToken: 'xoxb-harness' } },
    );
    const relations = createRelationRepository(db);
    const relation = await relations.create({
      installationId,
      growiUri: growi.baseUrl,
      growiLabel: 'fake GROWI',
      searchWeight: 1,
      settingsVersion: 1,
    });
    // The proxy verifies against the key it holds for the relation, so the
    // fake GROWI's own public half has to be stored as a peer key first.
    await createPeerKeyRepository(db).register(relation.relationId, {
      keyId: growi.ownKey.keyId,
      publicKeyJwk: growi.ownKey.publicKey.export({ format: 'jwk' }),
      validFrom: new Date(0).toISOString(),
    });

    const chat = createFakeChatService();
    const listener = listenOnFreePort();
    cluster = await startProxyCluster([
      {
        name: 'only',
        config: proxyConfig(growi.hostname),
        overrides: { listen: listener.listen, createFacade: chat.createFacade },
      },
    ]);

    const answer = await growi.callProxy(await listener.baseUrl(), {
      relationId: relation.relationId,
      op: OP_NAMES.capabilities,
    });

    // `capabilities` is proxy-wide, so a 200 with a report is the whole
    // exchange: the signature was accepted and the endpoint behind it ran.
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(
      expect.objectContaining({ platforms: expect.anything() }),
    );
  });
});
