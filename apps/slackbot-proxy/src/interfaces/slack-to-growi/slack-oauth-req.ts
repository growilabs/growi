import type { RequestFromSlack } from '@growi/slack';
import type { AuthorizeResult } from '@slack/oauth';
import type { Req } from '@tsed/common';

export type SlackOauthReq = Req &
  RequestFromSlack & {
    authorizeResult: AuthorizeResult;
    growiUri?: string;
  };
