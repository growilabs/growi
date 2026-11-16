// The two endpoints GROWI calls about an `agent` request it accepted:
// `command-answer` (here is the answer) and `conversation` (what was said
// where the request was made). design.md's CommandAnswerContract and
// ConversationContract; Requirements 5.7, 5.14, 15.7.
//
// Built the way `notification-routes.ts` is, for the reasons its header gives:
// this module builds its own guard, takes its paths from the guard's table,
// validates the body the guard verified rather than re-reading the request,
// and answers a body of the wrong shape with an empty 400. Every outcome the
// protocol names -- `unknown-request` included -- is a 200 with that result.
//
// Nothing below catches `AnswerFlow`'s failures, which become Hono's 500 with
// nothing of the failure in it: a storage failure, or a conversation read that
// failed for no reason the protocol names. GROWI retries an answer that met a
// 500; a conversation request that met one becomes GROWI's `rate-limited`
// answer to the requester, telling them to try again later (design.md
// RunAgentRequest), so the proxy does not pick a reason for it.
import {
  OP_NAMES,
  parseCommandAnswerRequest,
  parseConversationRequest,
} from '@growi/chat';
import type { Hono } from 'hono';

import type { AnswerFlow } from '../orchestration/index.js';
import type {
  SignatureGuardDeps,
  SignedRequestEnv,
} from './signature-guard.js';
import { pathForOp, signatureGuard } from './signature-guard.js';

export interface AgentInboundRoutesDeps {
  readonly signature: SignatureGuardDeps;
  readonly answerFlow: AnswerFlow;
}

export const registerAgentInboundRoutes = (
  app: Hono<SignedRequestEnv>,
  deps: AgentInboundRoutesDeps,
): void => {
  const guard = signatureGuard(deps.signature);
  const { answerFlow } = deps;

  app.post(pathForOp(OP_NAMES.commandAnswer), guard, async (c) => {
    const request = parseCommandAnswerRequest(c.get('verifiedBody'));
    if ('error' in request) {
      return c.body(null, 400);
    }
    return c.json(await answerFlow.deliver(request));
  });

  app.post(pathForOp(OP_NAMES.conversation), guard, async (c) => {
    const request = parseConversationRequest(c.get('verifiedBody'));
    if ('error' in request) {
      return c.body(null, 400);
    }
    return c.json(await answerFlow.readConversation(request));
  });
};
