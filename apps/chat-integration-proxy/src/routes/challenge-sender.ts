// Delivers the ownership challenge of pairing step 4 to the GROWI that
// declared itself at step 3, and hands step 5's answer back to
// `PairingService.submit` (Requirement 9.2).
//
// **This is the composition `SendChallenge` was declared for.**
// `relation/pairing-service.ts` sits to the LEFT of `growi/` in the dependency
// order and so cannot build an HTTP request itself; it takes the delivery as a
// parameter and its caller composes one. `routes/` is the rightmost layer, so
// it may reach `relation/` directly -- no injection detour is needed here.
//
// Four decisions are the contract rather than implementation taste:
//
//  - **The exchange goes through `GrowiUriResolver.connect()`**, never through
//    `fetch` or a raw `https.request`. A second place that builds a request to
//    a declared URI is a second place the address judgement can be missing
//    from -- the same rule `GrowiClient` follows.
//  - **The endpoint is addressed by a PATH, relative to the GROWI's own base
//    URL.** `PinnedConnection.send` applies that base itself (task 5.1), so a
//    whole URL written here would both apply the base twice and let the
//    exchange be aimed at a host the judgement never saw.
//  - **The raw answer is parsed HERE.** design.md requires step 5's answer to
//    pass `parseChallengeResponse` before anything is verified, and this is
//    where the raw bytes exist. `submit` runs the same check again as a
//    backstop against a defective sender (task 5.4's note); that backstop is
//    not this function's excuse to skip its own.
//  - **Failure is reported by throwing.** `SendChallenge` answers with a
//    `ChallengeResponse` and has no room for a failure value -- deliberately,
//    because it must not become a second way to report a refused URI
//    (task 5.4). `submit` catches every throw and answers
//    `ownership-unverified`, so nothing said here ever reaches the submitter.
import type { ChallengeResponse, OwnershipChallenge } from '@growi/chat';
import { parseChallengeResponse } from '@growi/chat';

import type { GrowiUriResolver, SendChallenge } from '../relation/index.js';

/**
 * Where GROWI serves the ownership challenge (the chat-integration-app spec's
 * endpoint table, 「（署名なし）」 row).
 *
 * Written out rather than looked up in `OP_ENDPOINTS`, because the protocol
 * package deliberately keeps both unsigned entry points OUT of that table --
 * they carry no `op` and no `relationId`, which every row of it declares --
 * and `op-names.spec.ts` asserts their absence. A lookup would therefore have
 * nothing to find; this constant is the path's one declaration on this side.
 */
export const CHALLENGE_ENDPOINT_PATH =
  '/_api/v3/chat-integration/peer/pairing/challenge';

const CONTENT_TYPE = 'application/json';

export interface ChallengeSenderDeps {
  readonly uriResolver: GrowiUriResolver;
}

export const createChallengeSender = (
  deps: ChallengeSenderDeps,
): SendChallenge => {
  const { uriResolver } = deps;

  return async (
    growiUri: string,
    challenge: OwnershipChallenge,
  ): Promise<ChallengeResponse> => {
    // Judged again here even though `submit` judged the same URI a moment ago:
    // `SendChallenge` is handed a URI and nothing else, so there is no
    // connection to carry over. That is not a redundancy to remove -- a
    // resolved address is held for a few seconds (task 5.1) so no name is
    // looked up twice in any meaningful sense, and 5.1 re-runs the judgement
    // even on a held address, so this second pass is a full check rather than
    // a weakened one.
    const connection = await uriResolver.connect(growiUri);
    if (!connection.ok) {
      throw new Error(
        `The declared GROWI URI was refused before the ownership challenge could be sent.`,
      );
    }

    const response = await connection.send({
      method: 'POST',
      path: CHALLENGE_ENDPOINT_PATH,
      headers: { 'content-type': CONTENT_TYPE },
      body: JSON.stringify(challenge),
    });

    if (response.status < 200 || response.status >= 300) {
      // GROWI answers 401 (the code does not match) or 410 (it expired) rather
      // than a `ChallengeResponse`, and any other non-2xx is the transport
      // failing -- in which case the body is whatever an intermediary wrote.
      // Same rule `GrowiClient` applies: a non-2xx body is not read at all.
      throw new Error(
        `The declared GROWI answered the ownership challenge with status ${response.status}.`,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(response.body);
    } catch {
      throw new Error(
        'The declared GROWI answered the ownership challenge with something that is not JSON.',
      );
    }

    const parsed = parseChallengeResponse(raw);
    if ('error' in parsed) {
      throw new Error(
        'The declared GROWI answered the ownership challenge with a body that is not a ChallengeResponse.',
      );
    }
    return parsed;
  };
};
