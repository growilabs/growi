import type { RequestHandler } from 'express';

import type { ApiV3Response } from '../../interfaces/apiv3-response';

/**
 * Run an Express `RequestHandler[]` array as Express itself would, stopping
 * at the first middleware that does not call `next()` (i.e. the one that
 * sent a response).
 *
 * Shared by the publish-page / unpublish-page / sync-latest-revision-body-
 * to-yjs-draft integration tests, which all drive the REAL middleware array
 * returned by their `*HandlersFactory` (not just the terminal handler),
 * because the read-only-user bug is about which middleware is present in
 * the chain, not about the terminal handler's own logic.
 */
export async function runMiddlewareChain(
  handlers: RequestHandler[],
  // biome-ignore lint/suspicious/noExplicitAny: minimal Express request shape
  req: any,
  res: ApiV3Response,
): Promise<void> {
  for (const handler of handlers) {
    let nextCalled = false;
    // biome-ignore lint/performance/noAwaitInLoops: middlewares must run sequentially, in Express's own order
    // biome-ignore lint/suspicious/noExplicitAny: express-validator chains and handlers have varying signatures
    await (handler as any)(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) {
      return;
    }
  }
}
