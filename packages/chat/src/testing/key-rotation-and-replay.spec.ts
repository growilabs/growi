// Integration tests for what happens to a relation AFTER pairing: rotating
// the peer's signing key, and telling a genuine retry apart from a replay
// (Requirement 10.3, 10.4, 10.5; design.md `MessageSignature` の Invariants
// のうち「受け入れる有効期間は最大 300 秒」「再送は `requestId` を据え置き、
// `nonce` と `created` / `expires` を取り直して署名し直す」の 2 つ).
//
// design.md の Testing Strategy では、Integration Tests の「鍵の入れ替え」
// （新旧が両方有効な間はどちらの署名も通ること・有効な鍵が 0 本になる失効が
// `would-leave-no-valid-key` で断られること）と、Unit Tests の「再送の署名」
// 「有効期間の上限」がここに当たる。番号で引かないのは、Integration Tests の
// 一覧に番号 `7` が 2 つあるという既知のずれがあるため（tasks.md
// Implementation Note 7.4）。
//
// `sign` / `verify` それ自体の単体試験は `signature/verify.spec.ts` にある。
// ここが足しているのは「ペアリングで実際に鍵を交換した 2 者の間で、鍵の追加と
// 失効が署名付きの往復として成立するか」で、鍵の保存・引き当て・失効判定の
// 配線まで含めて確かめる。

import type { KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMMAND_NAMES,
  type KeyRegistrationRequest,
  type KeyRevocationRequest,
  OP_NAMES,
  type OpName,
  parseCommandRequest,
  parseKeyRegistration,
  parseKeyRevocation,
  parseOpEnvelope,
} from '../index.js';
import {
  acceptEnvelope,
  encodeKeyId,
  judgeKeyRevocation,
  type KeyRef,
  MAX_ACCEPTED_EXPIRES_IN_SEC,
  type SignResult,
  sign,
  type VerifyParams,
  type VerifyResult,
  verify,
} from '../server.js';
import {
  createGrowiSide,
  createOwnKey,
  createProxySide,
  type GrowiSide,
  type OwnKey,
  type ProxySide,
  publicKeyRegistrationOf,
  type RelationRecord,
  resolvePeerPublicKey,
  runPairing,
  withPeerKeyRegistered,
  withPeerKeyRevoked,
} from './pairing-harness.js';

const GROWI_URI = 'https://growi.example.com';
const CONTENT_TYPE = 'application/json';

/** Anything that stores relations -- both sides do, under the same ids. */
interface RelationHolder {
  readonly relations: Map<string, RelationRecord>;
}

interface PairedCouple {
  readonly proxy: ProxySide;
  readonly growi: GrowiSide;
  readonly relationId: string;
}

const pairOnce = (): PairedCouple => {
  const proxy = createProxySide();
  const growi = createGrowiSide({ growiUri: GROWI_URI });
  const run = runPairing(proxy, growi);

  if (run.result.status !== 'paired') {
    throw new Error(
      `test setup: pairing did not complete (${run.result.status})`,
    );
  }
  return { proxy, growi, relationId: run.result.relationId };
};

const relationOf = (
  side: RelationHolder,
  relationId: string,
): RelationRecord => {
  const relation = side.relations.get(relationId);
  if (relation == null) {
    throw new Error('test setup: this side holds no such relation');
  }
  return relation;
};

const keyIdsOf = (relation: RelationRecord): readonly string[] =>
  relation.peerKeys.map((key) => key.keyId);

// ---------------------------------------------------------------------------
// One signed request, kept as the exact bytes and headers that would go on the
// wire. Both `verify` calls of a replay test are handed the SAME object, so a
// resend really is byte for byte -- rebuilding it would quietly produce a
// fresh signature and the test would pass for the wrong reason.
// ---------------------------------------------------------------------------

interface SignedRequest {
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
  readonly signed: SignResult;
}

const signRequest = (params: {
  readonly body: unknown;
  readonly key: KeyRef;
  readonly privateKey: KeyObject;
  readonly expiresInSec?: number;
}): SignedRequest => {
  const bytes = Buffer.from(JSON.stringify(params.body), 'utf8');
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
    key: params.key,
    privateKey: params.privateKey,
    expiresInSec: params.expiresInSec ?? 60,
  });
  return {
    bytes,
    headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
    signed,
  };
};

/** Accepts every nonce -- for tests where replay is not the subject. */
const acceptsEveryNonce: VerifyParams['consumeNonce'] = async () => true;

/**
 * A nonce store that answers `false` the second time the same
 * `(key, nonce)` pair arrives, which is the contract `verify` relies on
 * (Requirement 10.4). Namespaced by the full `KeyRef`, not by `keyId` alone
 * -- two relations may legitimately choose the same `keyId`.
 */
const createNonceStore = (): VerifyParams['consumeNonce'] => {
  const used = new Set<string>();
  return vi.fn((ref: KeyRef, nonce: string) => {
    const token = `${encodeKeyId(ref)}/${nonce}`;
    if (used.has(token)) {
      return Promise.resolve(false);
    }
    used.add(token);
    return Promise.resolve(true);
  });
};

/**
 * Checks a request as the receiving side would: the key is resolved from
 * THAT side's own relation record, through `resolvePeerPublicKey`, so a
 * revoked or not-yet-active key comes back as `null` and the request is
 * refused as `unknown-key`.
 *
 * The relation is looked up per call rather than captured, because a
 * registration or a revocation replaces the stored record.
 */
const verifyAsReceiver = (params: {
  readonly receiver: RelationHolder;
  readonly relationId: string;
  readonly request: SignedRequest;
  readonly now: Date;
  readonly consumeNonce?: VerifyParams['consumeNonce'];
}): Promise<VerifyResult> =>
  verify({
    method: 'POST',
    headers: params.request.headers,
    body: params.request.bytes,
    resolvePublicKey: async (ref) =>
      resolvePeerPublicKey(
        relationOf(params.receiver, params.relationId),
        ref,
        params.now,
      ),
    consumeNonce: params.consumeNonce ?? acceptsEveryNonce,
  });

/**
 * Signs a read-only envelope with `key` and checks it at `receiver`. This is
 * the probe used to ask "does this key still work?" -- `capabilities` is the
 * smallest body that carries `relationId` and `op` (`OpOnlyRequest`), so
 * nothing but key resolution decides the answer.
 */
const probeWithKey = (params: {
  readonly receiver: RelationHolder;
  readonly relationId: string;
  readonly key: OwnKey;
  readonly now: Date;
}): Promise<VerifyResult> => {
  const body = {
    relationId: params.relationId,
    op: OP_NAMES.capabilities,
  };
  expect(parseOpEnvelope(body)).toStrictEqual(body);

  return verifyAsReceiver({
    receiver: params.receiver,
    relationId: params.relationId,
    request: signRequest({
      body,
      key: { relationId: params.relationId, keyId: params.key.keyId },
      privateKey: params.key.privateKey,
    }),
    now: params.now,
  });
};

// ---------------------------------------------------------------------------
// The proxy's two key endpoints, wired the way a real receiving side has to
// wire them: verify the signature, re-check the body's shape, match the
// envelope against the relation the signature identified, and only then touch
// storage. Everything an endpoint is allowed to skip is skipped nowhere here
// -- that is what makes these tests integration tests rather than another
// unit test of `judgeKeyRevocation`.
// ---------------------------------------------------------------------------

interface EndpointOutcome<TBody> {
  readonly verified: VerifyResult;
  readonly body: TBody;
}

const receiveAtProxy = async <
  TBody extends { relationId: string; op: OpName },
>(params: {
  readonly proxy: ProxySide;
  readonly relationId: string;
  readonly body: TBody;
  readonly endpointOp: OpName;
  readonly signWith: OwnKey;
  readonly now: Date;
  readonly parse: (raw: unknown) => TBody | { readonly error: string };
}): Promise<EndpointOutcome<TBody>> => {
  const request = signRequest({
    body: params.body,
    key: { relationId: params.relationId, keyId: params.signWith.keyId },
    privateKey: params.signWith.privateKey,
  });
  const verified = await verifyAsReceiver({
    receiver: params.proxy,
    relationId: params.relationId,
    request,
    now: params.now,
  });
  if (!verified.ok) {
    throw new Error(
      `test setup: the request did not verify (${verified.failure})`,
    );
  }

  // The shape check runs on the bytes that arrived, not on the object the
  // test built -- the same order a real endpoint has to use.
  const parsed = params.parse(
    JSON.parse(Buffer.from(request.bytes).toString('utf8')),
  );
  if ('error' in parsed) {
    throw new Error(`test setup: the body is malformed (${parsed.error})`);
  }

  const accepted = acceptEnvelope(parsed, verified.key, params.endpointOp);
  if (!accepted.ok) {
    throw new Error('test setup: the envelope did not match the relation');
  }

  return { verified, body: accepted.body };
};

/** The proxy's `key-register-to-proxy` endpoint, end to end. */
const registerKeyAtProxy = async (params: {
  readonly proxy: ProxySide;
  readonly relationId: string;
  readonly signWith: OwnKey;
  readonly newKey: OwnKey;
  readonly now: Date;
}): Promise<EndpointOutcome<KeyRegistrationRequest>> => {
  const outcome = await receiveAtProxy<KeyRegistrationRequest>({
    proxy: params.proxy,
    relationId: params.relationId,
    endpointOp: OP_NAMES.keyRegisterToProxy,
    signWith: params.signWith,
    now: params.now,
    parse: parseKeyRegistration,
    body: {
      relationId: params.relationId,
      op: OP_NAMES.keyRegisterToProxy,
      key: publicKeyRegistrationOf(params.newKey),
    },
  });

  params.proxy.relations.set(
    params.relationId,
    withPeerKeyRegistered(
      relationOf(params.proxy, params.relationId),
      outcome.body.key,
    ),
  );
  return outcome;
};

/** The proxy's `key-revoke-to-proxy` endpoint, end to end. */
const revokeKeyAtProxy = async (params: {
  readonly proxy: ProxySide;
  readonly relationId: string;
  readonly signWith: OwnKey;
  readonly keyIdToRevoke: string;
  readonly now: Date;
}) => {
  const outcome = await receiveAtProxy<KeyRevocationRequest>({
    proxy: params.proxy,
    relationId: params.relationId,
    endpointOp: OP_NAMES.keyRevokeToProxy,
    signWith: params.signWith,
    now: params.now,
    parse: parseKeyRevocation,
    body: {
      relationId: params.relationId,
      op: OP_NAMES.keyRevokeToProxy,
      keyId: params.keyIdToRevoke,
    },
  });

  const { relation, result } = withPeerKeyRevoked(
    relationOf(params.proxy, params.relationId),
    outcome.body.keyId,
    params.now,
  );
  // Written back unconditionally: on a rejection `withPeerKeyRevoked` hands
  // the record back unchanged, so this cannot hide a refused revocation.
  params.proxy.relations.set(params.relationId, relation);
  return { ...outcome, result };
};

// ===========================================================================

describe('key rotation over an established relation', () => {
  const NOW = new Date('2026-03-01T00:00:00.000Z');
  const LATER = new Date(NOW.getTime() + 60_000);
  const FUTURE = new Date(NOW.getTime() + 3_600_000);

  it('resolves a peer key only for its own relation, while it is active and unrevoked', () => {
    const { proxy, growi, relationId } = pairOnce();
    const relation = relationOf(proxy, relationId);
    const known: KeyRef = { relationId, keyId: growi.ownKey.keyId };

    // The happy case, so that every `null` below is a real refusal rather
    // than a resolver that never answers at all.
    expect(resolvePeerPublicKey(relation, known, NOW)).not.toBeNull();

    // A `keyId` alone must never resolve a key: another relation using the
    // same `keyId` is legitimate (design.md "鍵の識別子 -- 関係ごとに一意に
    // する").
    expect(
      resolvePeerPublicKey(
        relation,
        { relationId: 'relation-somebody-else', keyId: growi.ownKey.keyId },
        NOW,
      ),
    ).toBeNull();
    expect(
      resolvePeerPublicKey(relation, { relationId, keyId: 'no-such-key' }, NOW),
    ).toBeNull();

    // The side's OWN key is never resolvable as the peer's -- the mistake
    // design.md's `resolvePublicKey` note warns about.
    expect(
      resolvePeerPublicKey(
        relation,
        { relationId, keyId: proxy.ownKey.keyId },
        NOW,
      ),
    ).toBeNull();
  });

  it('does not resolve a key whose `validFrom` has not arrived, nor one that is revoked', () => {
    const { proxy, growi, relationId } = pairOnce();
    const relation = relationOf(proxy, relationId);
    const active: KeyRef = { relationId, keyId: growi.ownKey.keyId };

    const notYetActive = withPeerKeyRegistered(
      relation,
      publicKeyRegistrationOf(
        createOwnKey('growi-next-key', FUTURE.toISOString()),
      ),
    );
    const future: KeyRef = { relationId, keyId: 'growi-next-key' };
    expect(resolvePeerPublicKey(notYetActive, future, NOW)).toBeNull();
    expect(resolvePeerPublicKey(notYetActive, future, FUTURE)).not.toBeNull();

    // Revoked, against a relation that also holds a second ACTIVE key, so
    // the revocation is allowed to go through at all.
    const withSpare = withPeerKeyRegistered(
      relation,
      publicKeyRegistrationOf(createOwnKey('growi-spare-key')),
    );
    const { relation: afterRevocation, result } = withPeerKeyRevoked(
      withSpare,
      active.keyId,
      LATER,
    );
    expect(result).toStrictEqual({ status: 'ok' });
    expect(resolvePeerPublicKey(afterRevocation, active, LATER)).toBeNull();
  });

  it('accepts BOTH the old and the new key while the two overlap', async () => {
    const { proxy, growi, relationId } = pairOnce();
    const oldKey = growi.ownKey;
    const newKey = createOwnKey('growi-rotated-key-1');

    // GROWI asks the proxy to add its next key, signing the request with the
    // key the proxy already trusts -- there is no other key it could use.
    const outcome = await registerKeyAtProxy({
      proxy,
      relationId,
      signWith: oldKey,
      newKey,
      now: NOW,
    });
    expect(outcome.verified).toStrictEqual({
      ok: true,
      key: { relationId, keyId: oldKey.keyId },
    });
    expect(outcome.body.key.keyId).toBe(newKey.keyId);

    // The old key is still there, unrevoked: registering a key does not
    // retire the previous one, which is what makes the overlap possible.
    expect(keyIdsOf(relationOf(proxy, relationId))).toStrictEqual([
      oldKey.keyId,
      newKey.keyId,
    ]);
    expect(
      relationOf(proxy, relationId).peerKeys.map((key) => key.revokedAt),
    ).toStrictEqual([null, null]);

    // And both really sign: neither side has to cut over at one instant
    // (Requirement 10.5).
    await expect(
      probeWithKey({ receiver: proxy, relationId, key: oldKey, now: NOW }),
    ).resolves.toStrictEqual({
      ok: true,
      key: { relationId, keyId: oldKey.keyId },
    });
    await expect(
      probeWithKey({ receiver: proxy, relationId, key: newKey, now: NOW }),
    ).resolves.toStrictEqual({
      ok: true,
      key: { relationId, keyId: newKey.keyId },
    });
  });

  it('stops accepting the old key once it is revoked, and keeps accepting the new one', async () => {
    const { proxy, growi, relationId } = pairOnce();
    const oldKey = growi.ownKey;
    const newKey = createOwnKey('growi-rotated-key-2');

    await registerKeyAtProxy({
      proxy,
      relationId,
      signWith: oldKey,
      newKey,
      now: NOW,
    });
    // Signed with the NEW key: by the time the old one is being retired, the
    // new one is the key GROWI wants to be judged by.
    const revocation = await revokeKeyAtProxy({
      proxy,
      relationId,
      signWith: newKey,
      keyIdToRevoke: oldKey.keyId,
      now: LATER,
    });
    expect(revocation.result).toStrictEqual({ status: 'ok' });

    const relation = relationOf(proxy, relationId);
    expect(keyIdsOf(relation)).toStrictEqual([oldKey.keyId, newKey.keyId]);
    expect(relation.peerKeys.map((key) => key.revokedAt)).toStrictEqual([
      LATER.toISOString(),
      null,
    ]);

    await expect(
      probeWithKey({ receiver: proxy, relationId, key: oldKey, now: LATER }),
    ).resolves.toStrictEqual({ ok: false, failure: 'unknown-key' });
    await expect(
      probeWithKey({ receiver: proxy, relationId, key: newKey, now: LATER }),
    ).resolves.toStrictEqual({
      ok: true,
      key: { relationId, keyId: newKey.keyId },
    });
  });
});

describe('a revocation that would leave no valid key', () => {
  const NOW = new Date('2026-03-01T00:00:00.000Z');
  const FUTURE = new Date(NOW.getTime() + 3_600_000);

  it('is refused when it names the relation’s only key, and changes nothing', async () => {
    const { proxy, growi, relationId } = pairOnce();
    const onlyKey = growi.ownKey;
    const before = relationOf(proxy, relationId);
    expect(keyIdsOf(before)).toStrictEqual([onlyKey.keyId]);

    const revocation = await revokeKeyAtProxy({
      proxy,
      relationId,
      signWith: onlyKey,
      keyIdToRevoke: onlyKey.keyId,
      now: NOW,
    });

    expect(revocation.result).toStrictEqual({
      status: 'rejected',
      reason: 'would-leave-no-valid-key',
    });
    // The endpoint's verdict is `judgeKeyRevocation`'s, not a second copy of
    // the rule kept on the storage side.
    expect(
      judgeKeyRevocation(before.peerKeys, onlyKey.keyId, NOW.toISOString()),
    ).toStrictEqual({
      ok: false,
      reason: 'would-leave-no-valid-key',
    });

    // Nothing was written: the relation still holds the key, unrevoked, and
    // it still verifies. A refusal that left the key half-retired would be
    // the same outcome as accepting it (Requirement 10.5, 10.6).
    expect(relationOf(proxy, relationId)).toStrictEqual(before);
    await expect(
      probeWithKey({ receiver: proxy, relationId, key: onlyKey, now: NOW }),
    ).resolves.toStrictEqual({
      ok: true,
      key: { relationId, keyId: onlyKey.keyId },
    });
  });

  it('is refused even when a not-yet-active key is already registered', async () => {
    const { proxy, growi, relationId } = pairOnce();
    const activeKey = growi.ownKey;
    // Registered ahead of the rotation: it exists and has never been
    // revoked, but its validity period has not begun.
    const futureKey = createOwnKey('growi-future-key', FUTURE.toISOString());

    await registerKeyAtProxy({
      proxy,
      relationId,
      signWith: activeKey,
      newKey: futureKey,
      now: NOW,
    });
    expect(keyIdsOf(relationOf(proxy, relationId))).toStrictEqual([
      activeKey.keyId,
      futureKey.keyId,
    ]);

    // This is the case that separates the real judgement from a plausible
    // imitation of it. Counting keys by `revokedAt == null` alone sees one
    // key left over and ACCEPTS -- and the relation is then left with
    // nothing either side can verify against until `validFrom` arrives.
    // `judgeKeyRevocation` counts only keys that are active AND unrevoked,
    // so it refuses (tasks.md Implementation Note 4.3).
    const revocation = await revokeKeyAtProxy({
      proxy,
      relationId,
      signWith: activeKey,
      keyIdToRevoke: activeKey.keyId,
      now: NOW,
    });
    expect(revocation.result).toStrictEqual({
      status: 'rejected',
      reason: 'would-leave-no-valid-key',
    });

    // The premise of that refusal, made observable: right now the future key
    // cannot verify anything, so retiring the active one would leave zero
    // usable keys.
    await expect(
      probeWithKey({ receiver: proxy, relationId, key: futureKey, now: NOW }),
    ).resolves.toStrictEqual({ ok: false, failure: 'unknown-key' });
    await expect(
      probeWithKey({ receiver: proxy, relationId, key: activeKey, now: NOW }),
    ).resolves.toStrictEqual({
      ok: true,
      key: { relationId, keyId: activeKey.keyId },
    });

    // Once the new key's validity period has begun, the same revocation
    // goes through -- the refusal was about the count of usable keys, not
    // about this key being unrevocable.
    const later = await revokeKeyAtProxy({
      proxy,
      relationId,
      signWith: futureKey,
      keyIdToRevoke: activeKey.keyId,
      now: FUTURE,
    });
    expect(later.result).toStrictEqual({ status: 'ok' });
  });

  it('refuses to revoke a `keyId` the relation never held', async () => {
    const { proxy, growi, relationId } = pairOnce();

    const revocation = await revokeKeyAtProxy({
      proxy,
      relationId,
      signWith: growi.ownKey,
      keyIdToRevoke: 'never-registered-key',
      now: NOW,
    });

    expect(revocation.result).toStrictEqual({
      status: 'rejected',
      reason: 'unknown-key',
    });
    expect(keyIdsOf(relationOf(proxy, relationId))).toStrictEqual([
      growi.ownKey.keyId,
    ]);
  });
});

describe('a retry against a replay', () => {
  const NOW_MS = new Date('2026-03-01T00:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses the same signed request twice, but accepts one re-signed under the same `requestId`', async () => {
    const { proxy, growi, relationId } = pairOnce();
    // proxy -> GROWI this time: `command` is the op that actually carries a
    // `requestId`, which is the value a retry has to keep (design.md
    // `CommandEnvelope.requestId`, Requirement 10.4).
    const body = {
      relationId,
      op: OP_NAMES.command,
      requestId: 'req-retry-0001',
      kind: COMMAND_NAMES.search,
      keyword: 'release notes',
      limit: 5,
      actor: {
        platform: 'slack',
        accountId: 'U0123456789',
        displayName: 'Example User',
      },
      channel: {
        platform: 'slack',
        channelId: 'C0123456789',
        channelName: 'general',
        isPrivate: false,
      },
    };
    expect(parseCommandRequest(body)).toStrictEqual(body);

    const key: KeyRef = { relationId, keyId: proxy.ownKey.keyId };
    const consumeNonce = createNonceStore();
    const first = signRequest({
      body,
      key,
      privateKey: proxy.ownKey.privateKey,
    });

    const check = (request: SignedRequest) =>
      verifyAsReceiver({
        receiver: growi,
        relationId,
        request,
        now: new Date(),
        consumeNonce,
      });

    await expect(check(first)).resolves.toStrictEqual({ ok: true, key });

    // The exact same bytes and the exact same headers -- the one-time value
    // has already been spent, so this cannot be told apart from an attacker
    // resending what it captured.
    await expect(check(first)).resolves.toStrictEqual({
      ok: false,
      failure: 'replayed',
    });

    // A genuine retry: the SAME body (so the same `requestId`, which is what
    // the receiving side matches a duplicate execution on), signed again with
    // a fresh nonce and fresh `created` / `expires`.
    vi.setSystemTime(NOW_MS + 5_000);
    const retry = signRequest({
      body,
      key,
      privateKey: proxy.ownKey.privateKey,
    });

    expect(Buffer.from(retry.bytes).equals(Buffer.from(first.bytes))).toBe(
      true,
    );
    expect(retry.signed.nonce).not.toBe(first.signed.nonce);
    expect(retry.headers['signature-input']).not.toBe(
      first.headers['signature-input'],
    );

    await expect(check(retry)).resolves.toStrictEqual({ ok: true, key });
  });
});

describe('the validity period the receiver actually applies', () => {
  const NOW_MS = new Date('2026-03-01T00:00:00.000Z').getTime();
  const NOW_SEC = Math.floor(NOW_MS / 1000);
  /** Far past the cap, and past anything a real caller would ask for. */
  const DECLARED_EXPIRES_IN_SEC = 100_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts a sender-declared validity period down to the cap', async () => {
    const { proxy, growi, relationId } = pairOnce();
    const key: KeyRef = { relationId, keyId: growi.ownKey.keyId };
    const consumeNonce = vi.fn(async () => true);

    const request = signRequest({
      body: { relationId, op: OP_NAMES.capabilities },
      key,
      privateKey: growi.ownKey.privateKey,
      expiresInSec: DECLARED_EXPIRES_IN_SEC,
    });
    // What the sender asked for really is far beyond the cap -- otherwise
    // the assertions below would hold for a request that never tested it.
    expect(request.signed.expiresAt).toStrictEqual(
      new Date((NOW_SEC + DECLARED_EXPIRES_IN_SEC) * 1000),
    );

    await expect(
      verifyAsReceiver({
        receiver: proxy,
        relationId,
        request,
        now: new Date(),
        consumeNonce,
      }),
    ).resolves.toStrictEqual({ ok: true, key });

    // The instant handed to the nonce store is the receiver's capped one.
    // With the sender's value the record would sit in the table for over a
    // day past the point the request stopped being accepted.
    expect(consumeNonce).toHaveBeenCalledWith(
      key,
      request.signed.nonce,
      new Date((NOW_SEC + MAX_ACCEPTED_EXPIRES_IN_SEC) * 1000),
    );
  });

  it('refuses the same request one second past the cap, however long the sender declared', async () => {
    const { proxy, growi, relationId } = pairOnce();
    const key: KeyRef = { relationId, keyId: growi.ownKey.keyId };
    const consumeNonce = vi.fn(async () => true);

    const request = signRequest({
      body: { relationId, op: OP_NAMES.capabilities },
      key,
      privateKey: growi.ownKey.privateKey,
      expiresInSec: DECLARED_EXPIRES_IN_SEC,
    });

    vi.setSystemTime(NOW_MS + (MAX_ACCEPTED_EXPIRES_IN_SEC + 1) * 1000);
    await expect(
      verifyAsReceiver({
        receiver: proxy,
        relationId,
        request,
        now: new Date(),
        consumeNonce,
      }),
    ).resolves.toStrictEqual({ ok: false, failure: 'expired' });

    // Refused for the expiry, not somewhere later in the checks: nothing was
    // written to the nonce store on the way out.
    expect(consumeNonce).not.toHaveBeenCalled();
  });
});
