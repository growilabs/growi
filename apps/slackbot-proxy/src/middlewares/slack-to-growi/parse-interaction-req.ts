import type { RequestFromSlack } from '@growi/slack';
import { type IMiddleware, Middleware, Next, Req } from '@tsed/common';

@Middleware()
export class ParseInteractionPayloadMiddleare implements IMiddleware {
  use(@Req() req: RequestFromSlack, @Next() next: Next): void {
    // There is no payload in the request from slack
    if (req.body.payload == null) {
      next();
      return;
    }

    req.interactionPayload = JSON.parse(req.body.payload);

    next();
  }
}
