import {
  IMiddleware, Middleware, Req, Res,
} from '@tsed/common';
import { SlackOauthReq } from '~/interfaces/slack-to-growi/slack-oauth-req';


@Middleware()
export class UrlVerificationMiddleware implements IMiddleware {

  async use(@Req() req: SlackOauthReq, @Res() res: Res): Promise<void> {

    // eslint-disable-next-line max-len
    // see: https://api.slack.com/apis/connections/events-api#the-events-api__subscribing-to-event-types__events-api-request-urls__request-url-configuration--verification
    if (req.body.type === 'url_verification') {
      res.send(req.body.challenge);
      return;
    }
  }

}
