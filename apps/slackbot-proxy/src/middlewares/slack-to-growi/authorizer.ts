import { AuthorizeResult, InstallationQuery } from '@slack/oauth';
import { IMiddleware, Inject, Middleware, Next, Req, Res } from '@tsed/common';
import Logger from 'bunyan';
import createError from 'http-errors';

import { SlackOauthReq } from '~/interfaces/slack-to-growi/slack-oauth-req';
import { InstallerService } from '~/services/InstallerService';
import loggerFactory from '~/utils/logger';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('@growi/slackbot-proxy:middlewares:authorizer');

const getCommonMiddleware = (
  query: InstallationQuery<boolean>,
  installerService: InstallerService,
  logger: Logger,
) => {
  return async (req: SlackOauthReq, res: Res, next: Next): Promise<void> => {
    if (query.teamId == null && query.enterpriseId == null) {
      next(createError(400, 'No installation found'));
      return;
    }

    let result: AuthorizeResult;
    try {
      result = await installerService.installer.authorize(query);

      if (result.botToken == null) {
        return next(
          createError(
            403,
            `The installation for the team(${query.teamId || query.enterpriseId}) has no botToken`,
          ),
        );
      }
    } catch (e) {
      logger.error(e.message);

      return next(createError(500, e.message));
    }

    // set authorized data
    req.authorizeResult = result;
    next();
  };
};
@Middleware()
export class AuthorizeCommandMiddleware implements IMiddleware {
  private logger: Logger;

  constructor() {
    this.logger = loggerFactory(
      'slackbot-proxy:middlewares:AuthorizeCommandMiddleware',
    );
  }

  @Inject()
  installerService: InstallerService;

  async use(
    @Req() req: SlackOauthReq,
    @Res() res: Res,
    @Next() next: Next,
  ): Promise<void> {
    const { body } = req;
    const teamId = body.team_id;
    const enterpriseId = body.enterprise_id;
    const isEnterpriseInstall = body.is_enterprise_install === 'true';
    const query: InstallationQuery<boolean> = {
      teamId,
      enterpriseId,
      isEnterpriseInstall,
    };

    const commonMiddleware = getCommonMiddleware(
      query,
      this.installerService,
      this.logger,
    );
    await commonMiddleware(req, res, next);
  }
}

@Middleware()
export class AuthorizeInteractionMiddleware implements IMiddleware {
  private logger: Logger;

  constructor() {
    this.logger = loggerFactory(
      'slackbot-proxy:middlewares:AuthorizeInteractionMiddleware',
    );
  }

  @Inject()
  installerService: InstallerService;

  async use(
    @Req() req: SlackOauthReq,
    @Res() res: Res,
    @Next() next: Next,
  ): Promise<void> {
    if (req.interactionPayload == null) {
      next(createError(400, 'The request has no payload.'));
      return;
    }

    const payload = req.interactionPayload;

    // extract id from body.payload
    const teamId = payload.team?.id;
    const enterpriseId = payload.enterprise?.id;
    const isEnterpriseInstall = payload.is_enterprise_install === 'true';

    const query: InstallationQuery<boolean> = {
      teamId,
      enterpriseId,
      isEnterpriseInstall,
    };

    const commonMiddleware = getCommonMiddleware(
      query,
      this.installerService,
      this.logger,
    );
    await commonMiddleware(req, res, next);
  }
}
@Middleware()
export class AuthorizeEventsMiddleware implements IMiddleware {
  private logger: Logger;

  constructor() {
    this.logger = loggerFactory(
      'slackbot-proxy:middlewares:AuthorizeEventsMiddleware',
    );
  }

  @Inject()
  installerService: InstallerService;

  async use(
    @Req() req: SlackOauthReq,
    @Res() res: Res,
    @Next() next: Next,
  ): Promise<void> {
    const { body } = req;
    const teamId = body.team_id;
    const enterpriseId = body.enterprise_id;
    const isEnterpriseInstall = body.is_enterprise_install === 'true';
    const query: InstallationQuery<boolean> = {
      teamId,
      enterpriseId,
      isEnterpriseInstall,
    };

    const commonMiddleware = getCommonMiddleware(
      query,
      this.installerService,
      this.logger,
    );
    await commonMiddleware(req, res, next);
  }
}
