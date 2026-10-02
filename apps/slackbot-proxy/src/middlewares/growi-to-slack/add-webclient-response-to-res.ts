import { ErrorCode } from '@slack/web-api';
import { IMiddleware, Middleware, Next, Req, Res } from '@tsed/common';

export type WebclientRes = Res & {
  simulateWebAPIRequestError: (
    error: string,
    statusCode: number,
  ) => WebclientRes;
  simulateWebAPIPlatformError: (
    error: string,
    errorCode?: string,
  ) => WebclientRes;
};

@Middleware()
export class AddWebclientResponseToRes implements IMiddleware {
  use(@Req() req: Req, @Res() res: WebclientRes, @Next() next: Next): void {
    // https://github.com/slackapi/node-slack-sdk/blob/7b95663a9ef31036367c066ccbf0021423278f40/packages/web-api/src/WebClient.ts#L356-L358
    res.simulateWebAPIRequestError = (error: string, statusCode?: number) => {
      return res
        .status(statusCode || 500)
        .send({ error, errorCode: ErrorCode.RequestError });
    };
    // https://github.com/slackapi/node-slack-sdk/blob/7b95663a9ef31036367c066ccbf0021423278f40/packages/web-api/src/WebClient.ts#L197-L199
    res.simulateWebAPIPlatformError = (error: string, errorCode?: string) => {
      return res.send({ ok: false, error, errorCode });
    };

    next();
  }
}
