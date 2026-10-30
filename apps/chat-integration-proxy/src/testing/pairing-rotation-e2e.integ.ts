// Task 11.5 -- pairing driven through the real HTTP endpoint, the judgement of
// the URL a GROWI declares about itself, a key rotation held up by one
// unreachable GROWI, and the absence of any chat-account-to-GROWI-user
// correspondence in storage.
//
// **This file is EXPECTED to be red in this devcontainer**, for the same
// reason `harness-round-trip.integ.ts`, `command-flow-e2e.integ.ts`,
// `notification-linking-e2e.integ.ts` and `instance-ownership-e2e.integ.ts`
// are: the `postgres` hostname does not resolve here (Implementation Note
// 1.2). That is not a defect of this task. There is deliberately no
// `beforeAll` -- a failing one SKIPS the bodies, so not one assertion below
// would ever be parsed while storage is unreachable.
//
// **Where the registration code comes from.** Requirement 9.1 says a code is
// issued 「管理者がチャット側で登録操作を行った」とき, and the first case below
// drives exactly that: `register` typed in a channel, by an actor the chat
// service reports as a workspace administrator. Issuance is deliberately not
// an HTTP endpoint (design.md's endpoint table has no row for it), so the
// other cases -- which are about the SUBMIT half, the URL judgement and the
// key rotation -- call `PairingService.issueCode` against the same PostgreSQL
// the running proxy uses rather than repeating the chat path each time.
//
// **Which requirement each case actually answers.** Of 11.5's list, 7.8, 9.1,
// 9.2, 9.5, 9.7 and 13.1 are 「the chat-integration proxy shall」 criteria and
// are answered here. 10.6 reaches this proxy through 10.7 (which mirrors 10.1-
// 10.4 and 10.6, and only those, onto the proxy) and is answered as 「保持して
// いる情報が漏れても相手になりすませない」: what is stored for a registration
// code is its hash, and what is stored for a peer is a public key.
// **10.5 is mis-cited for this task**: it reads 「the GROWI application shall
// 新旧どちらの鍵で送られたリクエストも処理する」, and 10.7 pointedly does NOT
// mirror it onto the proxy. The rotation property this file drives -- the old
// key stays in force until every GROWI has taken the new one -- is a design.md
// constraint, not Requirement 10.5. Note also that 9.7 appears in 11.5's
// requirement list but in none of its four bullets; it is why the first case
// below has a tail.

import { createHash, randomUUID } from 'node:crypto';
import type {
  KeyOperationResult,
  PairingResult,
  PairingSubmission,
} from '@growi/chat';
import { OP_NAMES, parsePairingResult } from '@growi/chat';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createOwnKeyRepository,
  createPrismaClient,
  type OwnKeyRecord,
  type PrismaClient,
} from '../db/index.js';
import { createGrowiClient } from '../growi/index.js';
import {
  createGrowiUriResolver,
  createPairingService,
  createRelationKeyService,
  REGISTRATION_CODE_TTL_MS,
} from '../relation/index.js';
import { PAIRING_SUBMIT_PATH } from '../routes/index.js';
import type { ClosedNetworkConfig, ProxyConfig } from '../runtime/index.js';
import { mentionOn } from './chat-events.js';
import type { FakeChatService } from './fake-chat-service.js';
import { createFakeChatService } from './fake-chat-service.js';
import type { FakeGrowi, FakeGrowiOptions } from './fake-growi.js';
import { startFakeGrowi } from './fake-growi.js';
import type { FreePortListener } from './free-port.js';
import { LOOPBACK, listenOnFreePort } from './free-port.js';
import {
  openWorkspace,
  pairGrowi,
  passthroughCipher,
} from './paired-workspace.js';
import { type ProxyCluster, startProxyCluster } from './proxy-cluster.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';
const CHAT_SDK_DATABASE_URL =
  process.env.CHAT_SDK_DATABASE_URL ??
  `${DATABASE_URL}?options=-c%20search_path%3Dchat_sdk`;

/**
 * Every fake GROWI listens on loopback over plain http, so one allow-list
 * entry serves them all -- and that entry is the whole point of the second
 * case below rather than a convenience: a loopback plain-http URL on an
 * arbitrary port breaks all three of `judgeGrowiUri`'s conditions at once, and
 * an operator declaring it is exactly the closed-network deployment
 * Requirement 13.1 asks for.
 */
const closedNetwork: ClosedNetworkConfig = {
  allowList: [LOOPBACK],
  trustedCaCertsFor: () => [],
};

const proxyConfig = (): ProxyConfig => ({
  platformApp: { stateConnectionString: CHAT_SDK_DATABASE_URL },
  closedNetwork,
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

/**
 * The proxy's own pairing service, built against the SAME database the running
 * instance uses. Only `issueCode` is called through it -- see the file header
 * for why the chat-started path cannot be driven.
 */
const pairingServiceOn = (db: PrismaClient) =>
  createPairingService({
    db,
    cipher: passthroughCipher,
    uriResolver: createGrowiUriResolver({ closedNetwork }),
  });

const submitPairing = async (
  proxyBaseUrl: string,
  submission: PairingSubmission,
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const response = await fetch(`${proxyBaseUrl}${PAIRING_SUBMIT_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(submission),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Left as text: an empty 400 has no JSON to read, and throwing here would
    // hide the status the case is about.
  }
  return { status: response.status, body };
};

const pairedOrThrow = (
  body: unknown,
): Extract<PairingResult, { status: 'paired' }> => {
  // Parsed with the same function GROWI's own side would use to read this
  // body -- the point of driving this over real HTTP is to confirm the wire
  // shape, not just the fields this test happens to read.
  const result = parsePairingResult(body);
  if ('error' in result) {
    throw new Error(`pairing response was malformed: ${JSON.stringify(body)}`);
  }
  if (result.status !== 'paired') {
    throw new Error(`pairing did not complete: ${JSON.stringify(result)}`);
  }
  return result;
};

// ---------------------------------------------------------------------------
// 登録コードの発行から成立まで (Requirements 9.1, 9.2, 9.5, 9.7)
// ---------------------------------------------------------------------------

describe('pairing, from an issued code through to a working relation', () => {
  it('establishes the relation over real HTTP, and the key that pairing registered is the one the GROWI is afterwards believed on', async () => {
    const growi = await openGrowi();
    const chat = createFakeChatService();
    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');

    const { code, expiresAt } = await pairingServiceOn(db).issueCode(
      workspace.installationId,
      workspace.actor,
    );
    // Requirement 9.1: 「一定時間で失効する」. A code with no expiry, or one
    // already past it, would leave the window this criterion bounds open on
    // the low side; the upper bound pins the window itself rather than just
    // its presence.
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + REGISTRATION_CODE_TTL_MS,
    );

    const listener = await startOneProxy(chat);
    const proxyBaseUrl = await listener.baseUrl();

    const answer = await submitPairing(proxyBaseUrl, {
      registrationCode: code,
      growiUri: growi.baseUrl,
      growiLabel: 'GROWI A',
      publicKey: growi.pairingRegistration,
    });

    expect(answer.status).toBe(200);
    const paired = pairedOrThrow(answer.body);
    expect(paired.workspace).toEqual({
      platform: 'slack',
      workspaceId: expect.any(String),
      workspaceName: 'slack workspace',
    });

    // Requirement 9.2: the ownership check really happened -- the challenge
    // reached the declared URL, and it named the code that was submitted.
    expect(growi.challenges()).toHaveLength(1);
    expect(growi.challenges()[0].registrationCode).toBe(code);

    // Requirement 9.5 / 9.6: what came back is a PUBLIC key, and the private
    // half of nothing travelled.
    expect(paired.publicKey.publicKeyJwk).toMatchObject({
      kty: 'OKP',
      crv: 'Ed25519',
    });
    expect(paired.publicKey.publicKeyJwk).not.toHaveProperty('d');

    // Requirement 9.5, the half that cannot be read off a row: nothing here
    // called `trustGrowiSignature`, so the ONLY way this signed request can be
    // accepted is that `submit` itself registered the key the GROWI declared.
    const believed = await growi.callProxy(proxyBaseUrl, {
      relationId: paired.relationId,
      op: OP_NAMES.capabilities,
    });
    expect(believed.status).toBe(200);

    // Requirement 9.7: once the administrator disconnects, the same request
    // signed with the same key is no longer processed.
    await pairingServiceOn(db).unpair(paired.relationId);
    const afterUnpair = await growi.callProxy(proxyBaseUrl, {
      relationId: paired.relationId,
      op: OP_NAMES.capabilities,
    });
    expect(afterUnpair.status).toBe(401);
  });

  it('issues the code from a `register` typed in chat by a workspace administrator, and that code pairs (Requirement 9.1)', async () => {
    const growi = await openGrowi();
    // The chat service reports this actor the way `ADMIN_CHECK_TABLE` says
    // Slack is read (`is_admin`). Unscripted, this fake answers `null` --
    // 「役割を読み取れなかった」 -- and every operator command is refused, so
    // acting as an administrator has to be said out loud.
    const chat = createFakeChatService({
      observeActorRoles: () => ({ grantedFields: ['is_admin'] }),
    });
    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');

    const listener = await startOneProxy(chat);
    const proxyBaseUrl = await listener.baseUrl();

    const typed = await chat.deliver(
      mentionOn('slack', {
        text: '@growi register',
        channel: workspace.channel,
        actor: workspace.actor,
      }),
    );
    expect(typed).toEqual({ handled: true });

    // 「登録コードは本人にだけ見えるメッセージで返す。チャンネルに平文で出さ
    // ない」: asserted as the whole list of what was posted, so a code that
    // ALSO reached the channel would fail here.
    const answers = chat.posts();
    expect(answers.map((post) => post.kind)).toEqual(['ephemeral']);
    const shown = answers[0].message;
    const code = (shown.kind === 'markdown' ? shown.markdown : '').match(
      /`([^`]+)`/,
    )?.[1];
    expect(code).toBeDefined();

    // The code is a real one: it pairs, over the same HTTP endpoint GROWI's
    // admin screen submits it to.
    const answer = await submitPairing(proxyBaseUrl, {
      registrationCode: code ?? '',
      growiUri: growi.baseUrl,
      growiLabel: 'GROWI A',
      publicKey: growi.pairingRegistration,
    });

    expect(answer.status).toBe(200);
    expect(pairedOrThrow(answer.body).relationId).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// 申告された URL の判定 (Requirements 9.2, 13.1)
// ---------------------------------------------------------------------------

/**
 * One URL per condition `judgeGrowiUri` checks, each breaking exactly that one.
 *
 * **Written as address literals, never as names.** `GrowiUriResolver` resolves
 * the host BEFORE it judges, so a name that does not resolve from wherever this
 * runs is answered `dns-failure` and never reaches the condition the case is
 * named for -- and because every refusal collapses into one message (below),
 * the case would still pass while demonstrating nothing. A literal is its own
 * resolution, so these three reach the judgement under any DNS.
 */
const BREAKS_ONE_CONDITION = [
  // scheme: https is required, and this host is public and on the default port
  ['scheme', 'http://93.184.216.34/'],
  // port: the default for https, and nothing else
  ['port', 'https://93.184.216.34:8443/'],
  // private address: RFC 1918, reachable only from inside a network
  ['private-address', 'https://10.0.0.1/'],
] as const;

describe('the URL a GROWI declares about itself', () => {
  it('is refused when it breaks any one of the three conditions, and nothing is sent to it', async () => {
    const growi = await openGrowi();
    const chat = createFakeChatService();
    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');

    const { code } = await pairingServiceOn(db).issueCode(
      workspace.installationId,
      workspace.actor,
    );
    const listener = await startOneProxy(chat);
    const proxyBaseUrl = await listener.baseUrl();

    for (const [condition, uri] of BREAKS_ONE_CONDITION) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose -- all three submissions carry the SAME code, and the attempt counter behind it is a conditional write; sent at once they would race for it.
      const answer = await submitPairing(proxyBaseUrl, {
        registrationCode: code,
        growiUri: uri,
        growiLabel: `declared as ${condition}`,
        publicKey: growi.pairingRegistration,
      });

      expect(answer.status).toBe(200);
      // The three are NOT told apart on the wire, and that is deliberate:
      // `PairingService` answers 「管理者に返すのは失敗の種類だけで、相手の
      // 応答の中身は返さない」, so which condition failed would describe the
      // network as this proxy sees it. Which condition each URL breaks is
      // `growi-uri-guard.spec.ts`'s subject, not this file's.
      expect(answer.body).toMatchObject({ status: 'ownership-unverified' });
    }

    // The property Requirement 9.2 exists for: a refused URL costs no outbound
    // traffic at all. Without this the three cases above could not tell
    // 「送る前に断った」 from 「送ったが返事が無かった」 -- both answer
    // `ownership-unverified`.
    expect(growi.challenges()).toEqual([]);
    // A second, WEAKER net -- not independent evidence. `received()` only
    // records ops this fake was given a responder for, and it was given none,
    // so it would stay empty even if the challenge had been fired at it.
    // `challenges()` above is what actually carries the property.
    expect(growi.received()).toEqual([]);

    // Requirement 13.1: the closed-network form -- plain http, an arbitrary
    // port, a loopback address -- breaks all three conditions at once, and
    // passes because the operator declared the host. The same code is used, so
    // this also shows the three refusals did not spend it -- this is the 4th
    // submission of one code, still under `MAX_SUBMISSION_ATTEMPTS` (5); a
    // future 5th case here would need a fresh code.
    const accepted = await submitPairing(proxyBaseUrl, {
      registrationCode: code,
      growiUri: growi.baseUrl,
      growiLabel: 'GROWI in a closed network',
      publicKey: growi.pairingRegistration,
    });
    expect(accepted.status).toBe(200);
    expect(pairedOrThrow(accepted.body).relationId).toEqual(expect.any(String));
    expect(growi.challenges()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 鍵の入れ替え (design.md 「古い鍵はまだ有効です」; NOT Requirement 10.5)
// ---------------------------------------------------------------------------

const KEY_OP_OK: KeyOperationResult = { status: 'ok' };

const keyOf = (
  keys: ReadonlyArray<OwnKeyRecord>,
  which: 'old' | 'new',
): OwnKeyRecord => {
  // The new key is the one that names the key it replaces; there is exactly
  // one of each while a rotation is under way.
  const match = keys.filter((key) =>
    which === 'new' ? key.supersededKeyId != null : key.supersededKeyId == null,
  );
  const [only, ...rest] = match;
  if (only == null || rest.length > 0) {
    throw new Error(
      `expected exactly one ${which} key, got ${match.length} of ${keys.length}`,
    );
  }
  return only;
};

describe('a key rotation with one GROWI that cannot take the new key', () => {
  it('leaves the old key in force until the second GROWI is fixed and the new key is delivered again', async () => {
    // The whole exchange is driven through the real `GrowiClient` over real
    // sockets. The operator commands that would start it (`rotate-key`,
    // `rotate-key status`) cannot complete through a running proxy today --
    // see the file header -- so this drives the two operations those commands
    // call, in the same order and with the same arguments `admin-flow.ts`
    // passes them.
    const growiA = await openGrowi({
      responders: {
        [OP_NAMES.keyRegisterToGrowi]: () => ({ body: KEY_OP_OK }),
        [OP_NAMES.keyRevokeToGrowi]: () => ({ body: KEY_OP_OK }),
      },
    });

    // 「届かない相手」. The socket stays open and answers 503 rather than being
    // closed: a relation stores ONE `growi_uri`, and a closed server cannot be
    // reopened on the same port without racing another process for it. Both
    // forms reach `deliver()` as the same value -- the key did not get through
    // -- and `relation-key-service.spec.ts` already covers the socket-error
    // form (`reason: 'unreachable'`) at unit level.
    let growiBIsUp = false;
    const growiB = await openGrowi({
      responders: {
        [OP_NAMES.keyRegisterToGrowi]: () =>
          growiBIsUp ? { body: KEY_OP_OK } : { status: 503, body: {} },
        [OP_NAMES.keyRevokeToGrowi]: () => ({ body: KEY_OP_OK }),
      },
    });

    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');
    const relationA = await pairGrowi(
      db,
      workspace.installationId,
      growiA,
      'A',
    );
    const relationB = await pairGrowi(
      db,
      workspace.installationId,
      growiB,
      'B',
    );

    const ownKeys = createOwnKeyRepository(db, passthroughCipher);
    const oldKeyIdA = keyOf(await ownKeys.listKeys(relationA), 'old').keyId;

    const keyService = createRelationKeyService({
      db,
      cipher: passthroughCipher,
    });
    const client = createGrowiClient({
      uriResolver: createGrowiUriResolver({ closedNetwork }),
      keyService,
    });

    // --- steps 1-3: mint, offer, report what did not get through ---
    const first = await keyService.rotate(
      workspace.installationId,
      client.registerKey,
    );
    const deliveryTo = (relationId: string) =>
      first.find((result) => result.relationId === relationId)?.delivery;
    expect(deliveryTo(relationA)).toEqual({ ok: true });
    expect(deliveryTo(relationB)).toMatchObject({ ok: false });

    // 「署名は古い鍵で行う」: the offer of the NEW key was itself signed with
    // the OLD one, proved by what the GROWI's own `verify()` resolved -- not by
    // what the body claimed.
    expect(growiA.received().map((request) => request.op)).toEqual([
      OP_NAMES.keyRegisterToGrowi,
    ]);
    expect(growiA.received()[0].verifiedKey.keyId).toBe(oldKeyIdA);

    // The discriminating check. `revokeOldIfAllDelivered` answers `false` for
    // three different situations, so its value alone cannot say whether a key
    // was revoked -- the row can.
    const heldUp = await keyService.revokeOldIfAllDelivered(
      workspace.installationId,
      client.revokeKey,
    );
    expect(heldUp).toBe(false);
    for (const relationId of [relationA, relationB]) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential so a failing read names the relation it was made for.
      const old = keyOf(await ownKeys.listKeys(relationId), 'old');
      expect(old.revokedAt).toBe(null);
    }
    // Nothing was even asked to revoke: 「全員に届いたときだけ」 stops the whole
    // installation, including the relation that was ready.
    expect(
      growiA.received().filter((r) => r.op === OP_NAMES.keyRevokeToGrowi),
    ).toEqual([]);

    // --- the operator fixes the second GROWI and runs `rotate-key` again ---
    growiBIsUp = true;
    const newKeyIdBefore = keyOf(
      await ownKeys.listKeys(relationB),
      'new',
    ).keyId;
    const second = await keyService.rotate(
      workspace.installationId,
      client.registerKey,
    );
    expect(
      second.find((result) => result.relationId === relationB)?.delivery,
    ).toEqual({ ok: true });
    // Re-offered, not re-minted: minting per attempt would pile keys up behind
    // an old one that never gets revoked.
    expect(keyOf(await ownKeys.listKeys(relationB), 'new').keyId).toBe(
      newKeyIdBefore,
    );

    // --- step 4: only now does the old key stop being valid ---
    const revoked = await keyService.revokeOldIfAllDelivered(
      workspace.installationId,
      client.revokeKey,
    );
    expect(revoked).toBe(true);
    for (const relationId of [relationA, relationB]) {
      // biome-ignore lint/performance/noAwaitInLoops: sequential so a failing read names the relation it was made for.
      const old = keyOf(await ownKeys.listKeys(relationId), 'old');
      expect(old.revokedAt).toBeInstanceOf(Date);
    }
    // 「古い鍵を失効させる前に、相手にも失効を伝える」, and that telling was
    // itself signed with the key being retired.
    const revocationToA = growiA
      .received()
      .filter((request) => request.op === OP_NAMES.keyRevokeToGrowi);
    expect(revocationToA).toHaveLength(1);
    expect(revocationToA[0].verifiedKey.keyId).toBe(oldKeyIdA);
    expect(revocationToA[0].body.keyId).toBe(oldKeyIdA);
  });
});

// ---------------------------------------------------------------------------
// 対応表を持たない (Requirement 7.8, and 10.6 through 10.7)
// ---------------------------------------------------------------------------

/**
 * Every column of this proxy's own schema whose name suggests it could carry a
 * person's identity, and what each of them actually holds.
 *
 * The one that names a chat account is `pending_collection.actor_account_id`,
 * and it is not a correspondence: the row is one command waiting for more
 * input, it carries an `expires_at`, and it names no GROWI user because
 * nothing in the protocol ever hands this proxy one -- `PairingSubmission` has
 * no such field, and neither does any request GROWI signs to it.
 *
 * This list is written out so that adding a column changes it: a future
 * implementer has to look at Requirement 7.8 again rather than discover it
 * held afterwards.
 */
const IDENTITY_BEARING_COLUMNS = ['pending_collection.actor_account_id'];

/**
 * And every column that names the GROWI side at all. It is an address and a
 * label -- never a user. The two lists together are what 「対応表を持たない」
 * means structurally: there is no row anywhere that could put a chat account
 * and a GROWI user side by side.
 */
const GROWI_BEARING_COLUMNS = ['relation.growi_uri', 'relation.growi_label'];

const NAMES_A_PERSON = /(account|user|member|actor|owner|principal)/i;

interface ColumnRow {
  readonly table_name: string;
  readonly column_name: string;
}

interface CountRow {
  readonly hits: bigint;
}

describe('what this proxy stores about who is who', () => {
  it('has nowhere to write a chat account against a GROWI user, and keeps only the hash of a registration code', async () => {
    const growi = await openGrowi();
    const chat = createFakeChatService();
    const db = openDb();
    const workspace = await openWorkspace(db, 'slack');

    // A pairing carried out by an identifiable person, so the search below is
    // looking for something that really passed through the proxy: `issueCode`
    // is handed the chat account that asked for the code.
    const issuer = { ...workspace.actor, accountId: `issuer-${randomUUID()}` };
    const { code } = await pairingServiceOn(db).issueCode(
      workspace.installationId,
      issuer,
    );

    const listener = await startOneProxy(chat);
    const answer = await submitPairing(await listener.baseUrl(), {
      registrationCode: code,
      growiUri: growi.baseUrl,
      growiLabel: 'GROWI A',
      publicKey: growi.pairingRegistration,
    });
    pairedOrThrow(answer.body);

    // --- what the schema is even able to hold ---
    const columns = await db.$queryRaw<ReadonlyArray<ColumnRow>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `;
    const named = (rows: ReadonlyArray<ColumnRow>, pattern: RegExp) =>
      rows
        .filter((row) => pattern.test(row.column_name))
        .map((row) => `${row.table_name}.${row.column_name}`)
        .sort();

    expect(named(columns, NAMES_A_PERSON)).toEqual(IDENTITY_BEARING_COLUMNS);
    expect(named(columns, /growi/i)).toEqual([...GROWI_BEARING_COLUMNS].sort());

    // --- and what it actually holds after a real pairing ---
    const tables = [...new Set(columns.map((column) => column.table_name))];
    /**
     * Casting the whole row to text catches a value wherever it landed --
     * including inside a `json` column, which a column-by-column read would
     * miss.
     */
    const rowsContaining = async (needle: string): Promise<number> => {
      let total = 0;
      for (const table of tables) {
        // biome-ignore lint/performance/noAwaitInLoops: sequential on purpose -- one connection, and a table at a time keeps a failing query attributable to its table.
        const [row] = await db.$queryRawUnsafe<ReadonlyArray<CountRow>>(
          `SELECT count(*)::bigint AS hits FROM "${table}" t WHERE t::text LIKE $1`,
          `%${needle}%`,
        );
        total += Number(row?.hits ?? 0);
      }
      return total;
    };

    // The positive control comes FIRST: a search that found nothing would
    // otherwise satisfy both assertions below for the wrong reason.
    const codeHash = createHash('sha256').update(code, 'utf8').digest('hex');
    expect(await rowsContaining(codeHash)).toBe(1);

    // Requirement 10.6 through 10.7: what is kept about a code is its hash, so
    // reading the whole database does not hand anyone a usable code.
    expect(await rowsContaining(code)).toBe(0);
    // Requirement 7.8: the person who started the pairing is not written down
    // anywhere. `issueCode` is handed them and stores nothing -- there is no
    // column to store them in.
    expect(await rowsContaining(issuer.accountId)).toBe(0);
  });
});
