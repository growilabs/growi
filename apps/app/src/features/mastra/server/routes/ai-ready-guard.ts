import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request } from 'express';

import { isAiConfigured } from '~/features/mastra/server/services/is-ai-configured';
import { isAiEnabled } from '~/features/mastra/server/services/is-ai-enabled';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

// Per-request availability gate for the mastra AI routes.
//
// Readiness (= enabled AND configured) is evaluated INSIDE the middleware body,
// not at module load / factory time, so a toggle or configuration change is
// reflected on the very next request without a server restart (Req 7.5).
//
// `isAiEnabled()` and `isAiConfigured()` are checked individually rather than via
// the combined `isAiReady()` so the 501 carries a message that distinguishes the
// two not-ready states (disabled vs misconfigured) for the client (Req 7.2).
export const aiReadyGuard = (
  _req: Request,
  res: ApiV3Response,
  next: NextFunction,
): void => {
  if (!isAiEnabled()) {
    res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
    return;
  }

  if (!isAiConfigured()) {
    res.apiv3Err(new ErrorV3('GROWI AI is not configured'), 501);
    return;
  }

  next();
};
