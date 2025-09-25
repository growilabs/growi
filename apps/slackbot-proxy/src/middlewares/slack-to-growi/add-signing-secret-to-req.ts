import type { RequestFromSlack } from '@growi/slack';
import { type IMiddleware, Middleware, Next, Req, Res } from '@tsed/common';

@Middleware()
export class AddSigningSecretToReq implements IMiddleware {
  use(
    @Req() req: Req & RequestFromSlack,
    @Res() res: Res,
    @Next() next: Next,
  ): void {
    req.slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
    next();
  }
}
