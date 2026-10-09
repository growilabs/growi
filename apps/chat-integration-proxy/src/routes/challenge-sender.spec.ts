// The first (and so far only) real implementation of `SendChallenge`
// (`relation/pairing-service.ts`, task 5.4). What is pinned down here is the
// three things a composer of a `PinnedConnection` and a contract type owns:
//
//  1. **What goes on the wire** -- a POST of the `OwnershipChallenge` to
//     GROWI's own unsigned pairing endpoint, addressed by a PATH relative to
//     the GROWI's base URL rather than by a whole URL.
//  2. **What is accepted back** -- nothing reaches `PairingService.submit`
//     that has not passed `parseChallengeResponse` here first.
//  3. **How failure is reported** -- by throwing, because the declared return
//     type carries a `ChallengeResponse` and has no room for a failure value.
//     `submit` turns every throw into `ownership-unverified`.

import type { OwnershipChallenge } from '@growi/chat';
import { describe, expect, it } from 'vitest';

import type {
  GrowiHttpRequest,
  GrowiHttpResponse,
  GrowiUriResolver,
} from '../relation/index.js';
import {
  CHALLENGE_ENDPOINT_PATH,
  createChallengeSender,
} from './challenge-sender.js';

const GROWI_URI = 'https://growi.example.com';

const CHALLENGE: OwnershipChallenge = {
  registrationCode: 'registration-code-under-test',
  challenge: 'Q0hBTExFTkdFLVZBTFVFLTMyLUNIQVJTLUxPTkctT0s',
};

const ANSWER = {
  challenge: CHALLENGE.challenge,
  challengeSignature: 'c2lnbmF0dXJlLXZhbHVl',
};

/** A resolver that connects and answers with whatever `respond` produces. */
const resolverAnswering = (
  respond: (request: GrowiHttpRequest) => GrowiHttpResponse,
): {
  readonly resolver: GrowiUriResolver;
  readonly sent: ReadonlyArray<GrowiHttpRequest>;
  readonly connectedTo: ReadonlyArray<string>;
} => {
  const sent: GrowiHttpRequest[] = [];
  const connectedTo: string[] = [];
  return {
    sent,
    connectedTo,
    resolver: {
      connect: (growiUri) => {
        connectedTo.push(growiUri);
        return Promise.resolve({
          ok: true,
          send: (request) => {
            sent.push(request);
            return Promise.resolve(respond(request));
          },
        });
      },
    },
  };
};

const jsonResponse = (body: unknown): GrowiHttpResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('createChallengeSender (pairing step 4, Requirement 9.2)', () => {
  it("POSTs the challenge to GROWI's own unsigned pairing endpoint", async () => {
    const { resolver, sent, connectedTo } = resolverAnswering(() =>
      jsonResponse(ANSWER),
    );

    const answer = await createChallengeSender({ uriResolver: resolver })(
      GROWI_URI,
      CHALLENGE,
    );

    expect(connectedTo).toEqual([GROWI_URI]);
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe('POST');
    expect(sent[0].path).toBe(CHALLENGE_ENDPOINT_PATH);
    expect(sent[0].headers?.['content-type']).toBe('application/json');
    expect(JSON.parse(sent[0].body ?? '')).toStrictEqual(CHALLENGE);
    expect(answer).toStrictEqual(ANSWER);
  });

  it('addresses the endpoint by path, never by a whole URL', () => {
    // `PinnedConnection.send` reads `request.path` relative to the GROWI URI's
    // own path and applies the base itself (task 5.1's note to 6.1). A whole
    // URL written here would both double the base path and let the exchange be
    // moved to another host -- and it is invisible in the final path, because
    // `new URL(absolute, base)` silently discards the base (task 6.1 measured
    // this). Asserting the absence of a scheme is what distinguishes the two.
    expect(CHALLENGE_ENDPOINT_PATH).not.toContain('://');
    expect(CHALLENGE_ENDPOINT_PATH).toBe(
      '/_api/v3/chat-integration/peer/pairing/challenge',
    );
  });

  it('refuses an answer whose shape does not hold, before it can be verified', async () => {
    // The step-5 answer is the one message this proxy accepts from a party it
    // holds no key for, so `parseChallengeResponse` is the whole acceptance
    // gate. `submit` runs it a second time as a backstop -- that backstop is
    // not this function's excuse to skip it (task 5.4's note).
    const { resolver } = resolverAnswering(() =>
      jsonResponse({ challenge: CHALLENGE.challenge }),
    );

    await expect(
      createChallengeSender({ uriResolver: resolver })(GROWI_URI, CHALLENGE),
    ).rejects.toBeInstanceOf(Error);
  });

  it('refuses an answer that is not JSON at all', async () => {
    const { resolver } = resolverAnswering(() => ({
      status: 200,
      headers: {},
      body: '<html>an intermediary’s error page</html>',
    }));

    await expect(
      createChallengeSender({ uriResolver: resolver })(GROWI_URI, CHALLENGE),
    ).rejects.toBeInstanceOf(Error);
  });

  it('refuses a non-2xx answer even when its body would have parsed', async () => {
    // GROWI answers 401 (code mismatch) or 410 (expired) here rather than a
    // `ChallengeResponse` (the contract type says so). The body carried below
    // is a perfectly well-formed answer on purpose: only the status check can
    // make this case fail, so dropping that check turns this test red.
    const { resolver } = resolverAnswering(() => ({
      status: 410,
      headers: {},
      body: JSON.stringify(ANSWER),
    }));

    await expect(
      createChallengeSender({ uriResolver: resolver })(GROWI_URI, CHALLENGE),
    ).rejects.toBeInstanceOf(Error);
  });

  it('throws when the declared URI is refused, and never opens an exchange', async () => {
    // Nothing may be sent to a URI the judgement turned down -- that is the
    // whole reason `submit` judges before it calls this function, and this
    // composer's own `connect()` must not be a way around it.
    // A refused `ConnectResult` carries no connection at all, so "nothing was
    // sent" is structural here; what this asserts is that the absence is
    // reported as a failure rather than read as an empty answer.
    const resolver: GrowiUriResolver = {
      connect: async () => ({ ok: false, reason: 'private-address' }),
    };

    await expect(
      createChallengeSender({ uriResolver: resolver })(GROWI_URI, CHALLENGE),
    ).rejects.toBeInstanceOf(Error);
  });

  it('lets a transport failure through as a failure, not as an answer', async () => {
    const resolver: GrowiUriResolver = {
      connect: () =>
        Promise.resolve({
          ok: true,
          send: () => Promise.reject(new Error('socket closed')),
        }),
    };

    await expect(
      createChallengeSender({ uriResolver: resolver })(GROWI_URI, CHALLENGE),
    ).rejects.toBeInstanceOf(Error);
  });
});
