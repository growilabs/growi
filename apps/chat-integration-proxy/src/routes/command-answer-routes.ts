// The `command-answer` endpoint behind the signature guard. Placeholder until
// task 3.5 wires the answer flow: it answers 501 rather than pretend delivery.
import { OP_NAMES } from '@growi/chat';
import type { Hono } from 'hono';

import type {
  SignatureGuardDeps,
  SignedRequestEnv,
} from './signature-guard.js';
import { pathForOp, signatureGuard } from './signature-guard.js';

export interface CommandAnswerRoutesDeps {
  readonly signature: SignatureGuardDeps;
}

export const registerCommandAnswerRoutes = (
  app: Hono<SignedRequestEnv>,
  deps: CommandAnswerRoutesDeps,
): void => {
  app.post(
    pathForOp(OP_NAMES.commandAnswer),
    signatureGuard(deps.signature),
    (c) => c.body(null, 501),
  );
};
