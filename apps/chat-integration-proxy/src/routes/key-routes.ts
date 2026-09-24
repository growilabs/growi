// The two endpoints a GROWI manages this proxy's copy of its public keys with:
// `key-register-to-proxy` (here is a key of mine) and `key-revoke-to-proxy`
// (stop trusting this one). design.md's 「GROWI から届く口」 table; Requirement
// 10.5.
//
// **Both handlers are pure wiring**, on the same four rules
// `notification-routes.ts` records for its pair: the guard is built here from
// `SignatureGuardDeps` rather than taken ready-made, the paths are looked up
// by op instead of written out, the body is the value the guard already parsed
// from the verified bytes, and a body of the wrong shape answers an empty 400
// rather than a 401.
//
// **Nothing here protects against a request being processed twice, and nothing
// needs to.** Registration is an upsert on `(relation_id, key_id)`, so a
// repeat changes nothing and still answers `ok`; revocation only sets
// `revoked_at`, so a repeat reaches the same state. That is design.md's
// per-endpoint duplicate table for these two rows, and it is `InboundFlow`'s
// (task 7.3) to keep -- this file would only weaken it by adding a second
// mechanism beside it.
//
// **A rejection is answered with 200 and the protocol's own body.**
// `KeyOperationResult` declares `{status: 'rejected', reason}` -- including
// `would-leave-no-valid-key`, the refusal that keeps a relation from losing
// its last usable key -- so the GROWI side has a field to read. Turning that
// into a 4xx would replace a shape the protocol owns with a status code it
// does not, and would make a legitimate, expected answer look like a fault.
// The empty 400 below is for the other case, where there is no protocol shape
// to answer with at all.
import {
  OP_NAMES,
  parseKeyRegistration,
  parseKeyRevocation,
} from '@growi/chat';
import type { Hono } from 'hono';

import type { InboundFlow } from '../orchestration/index.js';
import type {
  SignatureGuardDeps,
  SignedRequestEnv,
} from './signature-guard.js';
import { pathForOp, signatureGuard } from './signature-guard.js';

export interface KeyRoutesDeps {
  readonly signature: SignatureGuardDeps;
  /**
   * Narrowed with `Pick` for the reason `NotificationRoutesDeps.inboundFlow`
   * is: a reader can see from the type alone that neither of these two
   * endpoints can post a message or move a settings version, whatever a body
   * claims.
   */
  readonly inboundFlow: Pick<InboundFlow, 'registerPeerKey' | 'revokePeerKey'>;
}

export const registerKeyRoutes = (
  app: Hono<SignedRequestEnv>,
  deps: KeyRoutesDeps,
): void => {
  // `InboundFlow`'s failures are not caught, the same as in
  // `notification-routes.ts`: a storage failure becoming Hono's 500 lets GROWI
  // retry, and both endpoints are safe to retry.
  const guard = signatureGuard(deps.signature);
  const { inboundFlow } = deps;

  app.post(pathForOp(OP_NAMES.keyRegisterToProxy), guard, async (c) => {
    const request = parseKeyRegistration(c.get('verifiedBody'));
    if ('error' in request) {
      return c.body(null, 400);
    }
    return c.json(await inboundFlow.registerPeerKey(request));
  });

  app.post(pathForOp(OP_NAMES.keyRevokeToProxy), guard, async (c) => {
    const request = parseKeyRevocation(c.get('verifiedBody'));
    if ('error' in request) {
      return c.body(null, 400);
    }
    return c.json(await inboundFlow.revokePeerKey(request));
  });
};
