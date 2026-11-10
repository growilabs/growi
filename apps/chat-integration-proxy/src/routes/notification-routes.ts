// The two endpoints a GROWI pushes work to: `notification` (post this
// message to these channels) and `settings-push` (this is my current
// permission configuration). design.md's 「GROWI から届く口」 table, rows 1
// and 2; Requirements 2.1, 2.2, 10.7, 11.4.
//
// **These handlers hold no rules of their own.** Which destinations may be
// posted to, what a retry may skip, and whether a settings version is new
// enough all live in `orchestration/inbound-flow.ts`, where both endpoints'
// behaviour was written and tested as one piece. What is decided HERE, and
// nowhere else, is the four things an HTTP edge owns:
//
//  - **The guard is built here, not handed in.** `SignatureGuardDeps` is what
//    this module takes, and it constructs the middleware itself. Taking a
//    ready-made `MiddlewareHandler` would make "these paths are guarded" a
//    property of whoever wires the app up -- which is exactly the hole task
//    8.1 recorded when it noted that nothing yet forces 8.2-8.5 to mount the
//    guard.
//  - **The paths come from the guard's own table.** The guard refuses any
//    path `INBOUND_OP_BY_PATH` does not name, so a hand-written path with a
//    typo would not fail loudly -- it would serve 401s with no visible cause.
//    Looking the path up by op turns that into an error at wiring time.
//  - **The verified body is re-checked, never re-read.** `signatureGuard`
//    parsed the verified bytes once and put the value on the context; the
//    parse function below validates THAT value. `c.req.json()` would parse
//    the same cached bytes a second time and, while the guard is mounted,
//    reach the same value -- so no test can tell the two forms apart by their
//    *result*. What the two forms disagree on is which way they fail when the
//    guard is missing: reading `verifiedBody` fails CLOSED (it is `undefined`,
//    so parsing refuses with a 400 before `InboundFlow` is ever called), while
//    `c.req.json()` would fail OPEN (an unsigned body would parse and reach
//    the flow). Keeping this endpoint dependent on the context value the
//    guard sets, not on the request object directly, is what makes an
//    accidentally-unmounted guard closed rather than silently permissive.
//  - **A body of the wrong shape is an empty 400, not a 401.** By this point
//    the caller's signature has been verified, so it is the relation's own
//    GROWI, and the status code tells it what it needs. Answering 401 would
//    point an operator at a key that is working. The body stays empty for the
//    same reason the guard's 401 does: `@growi/chat` declares no error
//    response shape, and a shape invented here would be one the protocol
//    package does not own and the GROWI side cannot parse.
//
// Two non-conversions are deliberate. The parsed request is passed to
// `InboundFlow` unchanged: `pushSettings` already translates
// `allowedChannels`'s `'all'`/`'none'`/list spellings inside its own
// transaction, and re-checking `relationId` against the verified key would be
// a second copy of the cross-check `acceptEnvelope()` made in the guard --
// against this very same parsed value.
import {
  OP_NAMES,
  parseNotificationRequest,
  parseSettingsPush,
} from '@growi/chat';
import type { Hono } from 'hono';

import type { InboundFlow } from '../orchestration/index.js';
import type {
  SignatureGuardDeps,
  SignedRequestEnv,
} from './signature-guard.js';
import { pathForOp, signatureGuard } from './signature-guard.js';

export interface NotificationRoutesDeps {
  readonly signature: SignatureGuardDeps;
  /**
   * Narrowed with `Pick` for the reason `InboundFlowPlatform` is: a reader
   * can see from the type alone that neither of these two endpoints can
   * register or revoke a key, whatever a body claims.
   */
  readonly inboundFlow: Pick<InboundFlow, 'notify' | 'pushSettings'>;
}

export const registerNotificationRoutes = (
  app: Hono<SignedRequestEnv>,
  deps: NotificationRoutesDeps,
): void => {
  // Nothing below catches `InboundFlow`'s failures. A storage failure
  // becoming Hono's 500 is the wanted answer: GROWI retries, and both
  // endpoints are safe to retry (the per-destination record for notification,
  // the version guard for settings). Swallowing it would answer "done" for
  // work that never happened.
  const guard = signatureGuard(deps.signature);
  const { inboundFlow } = deps;

  app.post(pathForOp(OP_NAMES.notification), guard, async (c) => {
    const request = parseNotificationRequest(c.get('verifiedBody'));
    if ('error' in request) {
      return c.body(null, 400);
    }
    // Answered in full, including destinations an earlier attempt already
    // reached: GROWI writes this straight back into its outbox row, and an
    // answer covering only what was tried this time would erase the rest.
    return c.json(await inboundFlow.notify(request));
  });

  app.post(pathForOp(OP_NAMES.settingsPush), guard, async (c) => {
    const request = parseSettingsPush(c.get('verifiedBody'));
    if ('error' in request) {
      return c.body(null, 400);
    }
    await inboundFlow.pushSettings(request);
    // 204 whether the push was stored or discarded as older than what is
    // held (design.md's endpoint table). A discarded push is not a failure --
    // GROWI's retry of a save that has since been superseded has nothing to
    // fix, and telling it otherwise would make it retry forever.
    return c.body(null, 204);
  });
};
