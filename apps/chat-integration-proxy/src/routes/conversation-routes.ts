// The `conversation` endpoint behind the signature guard. Placeholder until
// task 3.5 wires the conversation reader: it answers 501 rather than pretend a read.
import { OP_NAMES } from '@growi/chat';
import type { Hono } from 'hono';

import type {
  SignatureGuardDeps,
  SignedRequestEnv,
} from './signature-guard.js';
import { pathForOp, signatureGuard } from './signature-guard.js';

export interface ConversationRoutesDeps {
  readonly signature: SignatureGuardDeps;
}

export const registerConversationRoutes = (
  app: Hono<SignedRequestEnv>,
  deps: ConversationRoutesDeps,
): void => {
  app.post(
    pathForOp(OP_NAMES.conversation),
    signatureGuard(deps.signature),
    (c) => c.body(null, 501),
  );
};
