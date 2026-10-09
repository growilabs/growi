// A GROWI that answers this proxy over a real socket (tasks.md 11.1's 「偽の
// GROWI -- 署名を検証して応答を返す HTTP サーバ。実際の往復に使う」).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// Three things make this a round trip rather than a stub:
//
//  - **It listens on a real port and speaks real HTTP.** `GrowiClient` reaches
//    it through `GrowiUriResolver`, which resolves the name, judges the
//    address and pins the connection to it. A fake reached by calling a
//    function would leave that whole path unexercised, and it is the path a
//    closed-network deployment (Requirement 13) depends on.
//  - **It verifies the signature with `@growi/chat`'s own `verify()`**, and
//    refuses with 401 when that fails. A fake that answered whatever it was
//    sent would let a later task pass with the signing removed.
//  - **It signs its own requests INTO the proxy with `sign()`**, so the eight
//    GROWI-facing endpoints can be driven by something the real
//    `signatureGuard` has to accept on its merits.
//
// What it deliberately does NOT do: decide what to answer. Every op's answer
// comes from a responder the caller supplies, and an op with no responder is
// answered 501 rather than with an invented body -- a scripted GROWI that
// filled in gaps by itself would let 11.2-11.5 assert against this file's
// guesses instead of against GROWI's contract.

import { type KeyObject, sign as nodeSign } from 'node:crypto';
import type {
  ChallengeResponse,
  OpName,
  OwnershipChallenge,
  PublicKeyRegistration,
  RequestEnvelope,
} from '@growi/chat';
import { OP_ENDPOINTS, parseOwnershipChallenge } from '@growi/chat';
import type { KeyRef, VerifyFailure } from '@growi/chat/server';
import {
  acceptEnvelope,
  DEFAULT_EXPIRES_IN_SEC,
  pairingChallengePayload,
  sign,
  verify,
} from '@growi/chat/server';
import { Hono } from 'hono';

// Reached past `routes/index.ts` on purpose: that barrel deliberately keeps
// `challenge-sender.ts` out of itself, and this constant is the app's ONE
// declaration of where the challenge is served. Writing the literal out again
// here would let the two drift apart without anything noticing.
import { CHALLENGE_ENDPOINT_PATH } from '../routes/challenge-sender.js';
import { LOOPBACK, serveOnFreePort } from './free-port.js';
import { createSigningIdentity, type PeerKey } from './signing-identity.js';

const GROWI_URI_PLACEHOLDER = '{growiUri}';
const PROXY_URI_PLACEHOLDER = '{proxyUri}';

/**
 * Which op each of this side's paths serves, derived from the shared endpoint
 * table rather than written out again. `routes/signature-guard.ts` builds
 * `INBOUND_OP_BY_PATH` the same way for the other direction; a hand-written
 * path here would make the fake answer 404 to a request the real GROWI serves.
 */
const OP_BY_PATH: ReadonlyMap<string, OpName> = new Map(
  Object.values(OP_ENDPOINTS)
    .filter((endpoint) => endpoint.direction === 'proxy-to-growi')
    .map((endpoint) => [
      endpoint.pathTemplate.replace(GROWI_URI_PLACEHOLDER, ''),
      endpoint.op,
    ]),
);

const proxyPathForOp = (op: OpName): string => {
  const endpoint = OP_ENDPOINTS[op];
  if (endpoint.direction !== 'growi-to-proxy') {
    throw new Error(`${op} is served by GROWI, not by the proxy.`);
  }
  return endpoint.pathTemplate.replace(PROXY_URI_PLACEHOLDER, '');
};

/** One request this GROWI verified and answered. */
export interface FakeGrowiRequest {
  readonly op: OpName;
  readonly path: string;
  /** The body as parsed from the verified bytes. */
  readonly body: RequestEnvelope & Readonly<Record<string, unknown>>;
  /** The relation and key the SIGNATURE proved, never the body's claim. */
  readonly verifiedKey: KeyRef;
}

export interface FakeGrowiRefusal {
  readonly path: string;
  readonly failure: VerifyFailure | 'envelope-mismatch';
}

/** What one op answers with. `status` defaults to 200. */
export interface ScriptedAnswer {
  readonly status?: number;
  readonly body: unknown;
}

export type OpResponder = (
  request: FakeGrowiRequest,
) => ScriptedAnswer | Promise<ScriptedAnswer>;

export interface FakeGrowiOptions {
  /**
   * What to answer per op. Taken as data rather than built in, so 11.2-11.5
   * each script the answers their own case needs
   * (`.claude/rules/coding-style.md`, "executors take their work-set as input").
   */
  readonly responders?: Partial<Readonly<Record<OpName, OpResponder>>>;
  /** This GROWI's own key id; generated when omitted. */
  readonly ownKeyId?: string;
  /** See `DEFAULT_EXPIRES_IN_SEC`; the proxy caps whatever it is handed. */
  readonly expiresInSec?: number;
}

export interface CallProxyParams {
  readonly relationId: string;
  readonly op: OpName;
  /** Merged with `relationId` and `op` to form the signed envelope. */
  readonly body?: Readonly<Record<string, unknown>>;
  /** Overrides the path the endpoint table gives, to exercise a wrong door. */
  readonly path?: string;
}

export interface ProxyAnswer {
  readonly status: number;
  readonly body: unknown;
}

export interface FakeGrowi {
  /** e.g. `http://127.0.0.1:49152` -- what a relation stores as `growi_uri`. */
  readonly baseUrl: string;
  /** Declare this in `GROWI_ALLOWED_DESTINATIONS` to make `baseUrl` reachable. */
  readonly hostname: string;
  /** The public half of this GROWI's own key, for the proxy to store as a peer. */
  readonly ownKey: { readonly keyId: string; readonly publicKey: KeyObject };
  /**
   * What this GROWI declares about itself at pairing step 3, ready to be put
   * into a `PairingSubmission`.
   *
   * **It names the same key as `ownKey`, and that is the contract rather than
   * a shortcut.** The key a GROWI submits while pairing is the key it later
   * signs its requests INTO the proxy with, so a fake that used two keys here
   * would let a pairing test pass while the relation it established was
   * useless for anything afterwards.
   */
  readonly pairingRegistration: PublicKeyRegistration;
  /** Every ownership challenge this GROWI was asked to answer, oldest first. */
  readonly challenges: () => ReadonlyArray<OwnershipChallenge>;
  /** Accepts signatures from this proxy key. Callable more than once. */
  readonly registerPeerKey: (peer: PeerKey) => void;
  /** Everything verified and answered so far, oldest first. */
  readonly received: () => ReadonlyArray<FakeGrowiRequest>;
  /** Everything refused, and why. */
  readonly refusals: () => ReadonlyArray<FakeGrowiRefusal>;
  /** Signs a request into the proxy and answers with what came back. */
  readonly callProxy: (
    proxyBaseUrl: string,
    params: CallProxyParams,
  ) => Promise<ProxyAnswer>;
  readonly close: () => Promise<void>;
}

const isEnvelope = (
  value: unknown,
): value is RequestEnvelope & Readonly<Record<string, unknown>> =>
  typeof value === 'object' &&
  value != null &&
  typeof (value as { relationId?: unknown }).relationId === 'string' &&
  typeof (value as { op?: unknown }).op === 'string';

export const startFakeGrowi = async (
  options: FakeGrowiOptions = {},
): Promise<FakeGrowi> => {
  const { responders = {}, expiresInSec = DEFAULT_EXPIRES_IN_SEC } = options;

  const received: FakeGrowiRequest[] = [];
  const refusals: FakeGrowiRefusal[] = [];
  const challenges: OwnershipChallenge[] = [];
  const peerKeys = new Map<string, KeyObject>();
  /** Spent nonces, namespaced by relation AND key (never by nonce alone). */
  const spentNonces = new Set<string>();

  const peerKeyId = (ref: KeyRef): string => `${ref.relationId}:${ref.keyId}`;

  const own = createSigningIdentity(
    // Replaced per call: this side's key is one key used across every relation
    // it is paired with, and the relation is only known when a call is made.
    'placeholder',
    options.ownKeyId ?? 'fake-growi-key-1',
  );
  const pairingRegistration: PublicKeyRegistration = {
    keyId: own.key.keyId,
    publicKeyJwk: own.publicKey.export({ format: 'jwk' }),
    validFrom: new Date(0).toISOString(),
  };

  const app = new Hono();

  // Pairing step 5, and the ONE answer this fake decides for itself.
  //
  // The file header's rule -- an op's answer comes from a responder, never
  // from a guess made here -- is about answers that are POLICY: what GROWI
  // decides to do with a command is GROWI's business, and inventing one would
  // let a test assert against this file. The ownership proof is not policy.
  // It is a cryptographic derivation with exactly one correct value, fixed by
  // `pairingChallengePayload` and by the key declared in
  // `pairingRegistration`, so producing it here invents nothing.
  //
  // Registered BEFORE the catch-all below, which answers 404 to any path the
  // shared endpoint table does not name -- and this path is deliberately
  // absent from that table (it carries no `op` and no `relationId`).
  //
  // There is no hook for answering dishonestly. Every tampered form -- a
  // challenge echoed back changed, a signature made with another key, a body
  // that is not a `ChallengeResponse` -- is already driven directly against
  // `PairingService.submit` in `pairing-service.spec.ts`, and a second way to
  // produce them would be a second place for what "wrong" means to live.
  app.post(CHALLENGE_ENDPOINT_PATH, async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.body(null, 400);
    }
    const challenge = parseOwnershipChallenge(raw);
    if ('error' in challenge) {
      return c.body(null, 400);
    }

    challenges.push(challenge);
    const answer: ChallengeResponse = {
      // Echoed back rather than left out: `submit` compares this against the
      // value it generated before it looks at the signature at all.
      challenge: challenge.challenge,
      challengeSignature: nodeSign(
        // Ed25519 signs the message itself -- no digest algorithm is named.
        null,
        Buffer.from(
          // NOT the bare challenge: the purpose prefix is what keeps step 5
          // from being a window that signs any string a caller chooses.
          pairingChallengePayload(
            challenge.registrationCode,
            challenge.challenge,
          ),
          'utf8',
        ),
        own.privateKey,
      ).toString('base64url'),
    };
    return c.json(answer);
  });

  app.post('*', async (c) => {
    const path = new URL(c.req.url).pathname;
    const op = OP_BY_PATH.get(path);
    if (op == null) {
      return c.json({ error: `no GROWI op is served at ${path}` }, 404);
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    const result = await verify({
      method: c.req.method,
      headers: c.req.header(),
      body,
      resolvePublicKey: (ref) =>
        Promise.resolve(peerKeys.get(peerKeyId(ref)) ?? null),
      consumeNonce: (ref, nonce) => {
        const id = `${peerKeyId(ref)}:${nonce}`;
        if (spentNonces.has(id)) return Promise.resolve(false);
        spentNonces.add(id);
        return Promise.resolve(true);
      },
    });
    if (!result.ok) {
      refusals.push({ path, failure: result.failure });
      // No reason travels back: the real GROWI tells an unauthenticated caller
      // nothing about why (design.md's Security Considerations).
      return c.body(null, 401);
    }

    // Parsed from the bytes the signature covered, never re-read from the
    // request -- the same rule `signatureGuard` follows on the other side.
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!isEnvelope(parsed)) {
      refusals.push({ path, failure: 'malformed' });
      return c.body(null, 400);
    }
    const accepted = acceptEnvelope(parsed, result.key, op);
    if (!accepted.ok) {
      refusals.push({ path, failure: 'envelope-mismatch' });
      return c.body(null, 400);
    }

    const request: FakeGrowiRequest = {
      op,
      path,
      body: accepted.body,
      verifiedKey: result.key,
    };
    const responder = responders[op];
    if (responder == null) {
      // Not recorded as received: this GROWI never answered it, and a test
      // that read it as a completed exchange would be reading a gap.
      return c.json(
        { error: `this fake GROWI was given no responder for '${op}'` },
        501,
      );
    }

    received.push(request);
    const answer = await responder(request);
    return c.json(answer.body as never, (answer.status ?? 200) as never);
  });

  const { server, baseUrl } = await serveOnFreePort(app);

  return {
    baseUrl,
    hostname: LOOPBACK,
    ownKey: { keyId: own.key.keyId, publicKey: own.publicKey },
    pairingRegistration,
    challenges: () => [...challenges],
    registerPeerKey: (peer) => {
      peerKeys.set(peerKeyId(peer.key), peer.publicKey);
    },
    received: () => [...received],
    refusals: () => [...refusals],

    callProxy: async (proxyBaseUrl, params) => {
      const envelope = {
        ...params.body,
        relationId: params.relationId,
        op: params.op,
      };
      // Serialized once: these bytes are both what is hashed and what is sent.
      const payload = JSON.stringify(envelope);
      const headers = { 'content-type': 'application/json' };
      const signed = sign({
        method: 'POST',
        headers,
        body: Buffer.from(payload, 'utf8'),
        key: { relationId: params.relationId, keyId: own.key.keyId },
        privateKey: own.privateKey,
        expiresInSec,
      });

      const response = await fetch(
        `${proxyBaseUrl}${params.path ?? proxyPathForOp(params.op)}`,
        {
          method: 'POST',
          headers: { ...headers, ...signed.headers },
          body: payload,
        },
      );
      const text = await response.text();
      let parsedAnswer: unknown = text;
      try {
        parsedAnswer = JSON.parse(text);
      } catch {
        // Left as text: an intermediary's error page is not JSON, and a
        // harness that threw on it would hide the status the caller wants.
      }
      return { status: response.status, body: parsedAnswer };
    },

    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)));
      }),
  };
};
