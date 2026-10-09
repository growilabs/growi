// The pairing submission (design.md's 「GROWI から届く口」 table, the
// 「（署名なし）」 row; Requirements 9.1, 9.2, 9.5).
//
// **This is the only endpoint on this proxy that carries no signature**, and
// the reason is structural rather than a relaxation: pairing is what
// establishes the keys, so at this point in the handshake there is nothing to
// verify a signature against. Two consequences shape this file.
//
//  - **The body check is the whole gate.** Every other endpoint runs its parse
//    function on bytes a signature already vouched for; here `parsePairingSubmission`
//    is the first and only thing standing between the endpoint and whatever
//    was posted. It is never skipped, weakened, or run after any work.
//  - **`signatureGuard` is deliberately NOT mounted**, and this path is
//    deliberately absent from `INBOUND_OP_BY_PATH`: the guard refuses any path
//    that table does not name, so mounting it here would refuse every
//    submission with a 401 no operator could explain. **Task 8.5's
//    guard-coverage check must read that table, not the app's route list** --
//    then this path is outside its scope by construction rather than by an
//    exception list someone has to remember to keep.
//
// **How refusals are answered, and why the two forms differ.**
//
//  - A body that does not parse -- unreadable as JSON, or readable but not a
//    `PairingSubmission` -- is answered with an EMPTY 400. `@growi/chat`
//    declares no error-response shape (its endpoint table's answer column
//    carries only successes), and inventing one here would be a shape the
//    protocol package does not own and the GROWI side cannot read. **It is not
//    a 401**: the 401 of `signature-guard.ts` says "your signature did not
//    verify", which here would point an operator at a key that does not exist
//    yet on either side.
//  - Every `PairingResult` -- including `code-expired` and
//    `ownership-unverified` -- is answered with 200 and the protocol's own
//    body, the same treatment `key-routes.ts` gives `KeyOperationResult`'s
//    rejections. These are expected, legitimate answers with a field the GROWI
//    side reads and shows an administrator; a 4xx would replace a shape the
//    protocol owns with a status code it does not.
//
// **Nothing here guards against a submission arriving twice**, and nothing
// should: `PairingService.submit` (task 5.4) consumes the order with a
// conditional write, so only one copy mints a relation and every other answers
// with the winner's result. This endpoint carries neither a signature nor a
// one-time value, which makes it the most resendable entry point in the
// protocol -- a second mechanism added here would only give that contract a
// second place to be got wrong.
import { parsePairingSubmission } from '@growi/chat';
import type { Env, Hono } from 'hono';

import type { GrowiUriResolver, PairingService } from '../relation/index.js';
import { createChallengeSender } from './challenge-sender.js';

/**
 * Written out rather than looked up by op: this endpoint has no `op` at all
 * (see the header comment), so `pathForOp` has nothing to find. design.md's
 * endpoint table is where the value comes from.
 */
export const PAIRING_SUBMIT_PATH = '/chat-integration/pairing/submit';

export interface PairingRoutesDeps {
  /**
   * Narrowed with `Pick` the way the other route modules narrow theirs: a
   * reader can see from the type alone that this endpoint cannot issue a
   * registration code or take a relation apart, whatever a body claims.
   */
  readonly pairingService: Pick<PairingService, 'submit'>;
  /**
   * Used to BUILD the challenge delivery here, rather than taking a
   * ready-made `SendChallenge`. Same rule `notification-routes.ts` records for
   * the guard: taken ready-made, "the challenge is delivered over a judged
   * connection" would become a property of whoever wires the app up, and a
   * test could only confirm the double it passed in.
   */
  readonly uriResolver: GrowiUriResolver;
}

/**
 * Generic in `E` rather than taking a bare `Hono` (which is `Hono<BlankEnv>`):
 * Hono's `Env` parameter is contravariant in the handler position, so a
 * `Hono<SignedRequestEnv>` -- what the other three route registrars require --
 * is NOT assignable to a bare `Hono`. Task 8.5 registers all four modules on
 * ONE app, and this signature is what lets it do so without a cast. This
 * endpoint still reads nothing the guard puts into the context, so widening
 * `E` gives it no access it did not already have.
 */
export const registerPairingRoutes = <E extends Env>(
  app: Hono<E>,
  deps: PairingRoutesDeps,
): void => {
  const { pairingService } = deps;
  const sendChallenge = createChallengeSender({
    uriResolver: deps.uriResolver,
  });

  app.post(PAIRING_SUBMIT_PATH, async (c) => {
    // Read as a parsed value, not as raw bytes: there is no `content-digest`
    // here whose byte-exactness has to be preserved, and
    // `parsePairingSubmission` takes an already-parsed `unknown`. A body that
    // is not JSON must not escape as an exception -- with no guard in front of
    // this endpoint, an unreadable body is the FIRST thing it meets, and Hono's
    // 500 would report a broken proxy where a caller sent nonsense.
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.body(null, 400);
    }

    const request = parsePairingSubmission(raw);
    if ('error' in request) {
      return c.body(null, 400);
    }

    // `submit` never throws for a submission's own sake -- a refused URI, an
    // unreachable GROWI and an unproven answer all come back as
    // `ownership-unverified`, and the reason behind them is deliberately not
    // carried out (it would describe the network as this proxy sees it). A
    // storage failure still becomes Hono's 500, which is the wanted answer:
    // resubmitting is safe, and answering "done" for a pairing that never
    // happened would leave a GROWI holding a relation id nothing matches.
    return c.json(await pairingService.submit(request, sendChallenge));
  });
};
