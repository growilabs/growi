import { ServerResponse } from 'node:http';

import {
  type GrowiCommand,
  type IChannelOptionalId,
  REQUEST_TIMEOUT_FOR_PTOG,
  requiredScopes,
  supportedGrowiCommands,
} from '@growi/slack';
import {
  parseSlackInteractionRequest,
  verifySlackRequest,
} from '@growi/slack/dist/middlewares';
import { InvalidGrowiCommandError } from '@growi/slack/dist/models';
import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import { respondRejectedErrors } from '@growi/slack/dist/utils/post-ephemeral-errors';
import { respond } from '@growi/slack/dist/utils/response-url';
import { parseSlashCommand } from '@growi/slack/dist/utils/slash-command-parser';
import { generateWebClient } from '@growi/slack/dist/utils/webclient-factory';
import { Installation } from '@slack/oauth';
import { WebAPICallResult } from '@slack/web-api';
import {
  Controller,
  Get,
  Inject,
  PlatformResponse,
  Post,
  Req,
  Res,
  UseBefore,
} from '@tsed/common';
import axios from 'axios';

import { Relation } from '~/entities/relation';
import { SlackOauthReq } from '~/interfaces/slack-to-growi/slack-oauth-req';
import { AddSigningSecretToReq } from '~/middlewares/slack-to-growi/add-signing-secret-to-req';
import {
  AuthorizeCommandMiddleware,
  AuthorizeEventsMiddleware,
  AuthorizeInteractionMiddleware,
} from '~/middlewares/slack-to-growi/authorizer';
import { ExtractGrowiUriFromReq } from '~/middlewares/slack-to-growi/extract-growi-uri-from-req';
import { UrlVerificationMiddleware } from '~/middlewares/slack-to-growi/url-verification';
import { InstallationRepository } from '~/repositories/installation';
import { OrderRepository } from '~/repositories/order';
import { RelationRepository } from '~/repositories/relation';
import { InstallerService } from '~/services/InstallerService';
import { LinkSharedService } from '~/services/LinkSharedService';
import { RegisterService } from '~/services/RegisterService';
import { RelationsService } from '~/services/RelationsService';
import { SelectGrowiService } from '~/services/SelectGrowiService';
import { UnregisterService } from '~/services/UnregisterService';
import loggerFactory from '~/utils/logger';
import {
  postInstallSuccessMessage,
  postWelcomeMessageOnce,
} from '~/utils/welcome-message';

const logger = loggerFactory('slackbot-proxy:controllers:slack');

const postNotAllowedMessage = async (
  responseUrl,
  disallowedGrowiUrls: Set<string>,
  commandName: string,
): Promise<void> => {
  const linkUrlList = Array.from(disallowedGrowiUrls).map((growiUrl) => {
    return `\n• ${new URL('/admin/slack-integration', growiUrl).toString()}`;
  });

  const growiDocsLink =
    'https://docs.growi.org/en/admin-guide/upgrading/43x.html';

  await respond(responseUrl, {
    text: 'Error occured.',
    blocks: [
      markdownSectionBlock('*None of GROWI permitted the command.*'),
      markdownSectionBlock(`*'${commandName}'* command was not allowed.`),
      markdownSectionBlock(
        `To use this command, modify settings from following pages: ${linkUrlList}`,
      ),
      markdownSectionBlock(
        `Or, if your GROWI version is 4.3.0 or below, upgrade GROWI to use commands and permission settings: ${growiDocsLink}`,
      ),
    ],
  });

  return;
};
@Controller('/slack')
export class SlackCtrl {
  @Inject()
  installerService: InstallerService;

  @Inject()
  installationRepository: InstallationRepository;

  @Inject()
  relationRepository: RelationRepository;

  @Inject()
  orderRepository: OrderRepository;

  @Inject()
  selectGrowiService: SelectGrowiService;

  @Inject()
  registerService: RegisterService;

  @Inject()
  relationsService: RelationsService;

  @Inject()
  unregisterService: UnregisterService;

  @Inject()
  linkSharedService: LinkSharedService;

  /**
   * Send command to specified GROWIs
   * @param growiCommand
   * @param relations
   * @param body
   * @returns
   */
  private async sendCommand(
    growiCommand: GrowiCommand,
    relations: Relation[],
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    body: any,
  ) {
    if (relations.length === 0) {
      throw new Error('relations must be set');
    }

    const promises = relations.map((relation: Relation) => {
      // generate API URL
      const url = new URL(
        '/_api/v3/slack-integration/proxied/commands',
        relation.growiUri,
      );
      return axios.post(
        url.toString(),
        {
          ...body,
          growiCommand,
        },
        {
          headers: {
            'x-growi-ptog-tokens': relation.tokenPtoG,
          },
          timeout: REQUEST_TIMEOUT_FOR_PTOG,
        },
      );
    });

    // pickup PromiseRejectedResult only
    const results = await Promise.allSettled(promises);
    const rejectedResults: PromiseRejectedResult[] = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    try {
      return respondRejectedErrors(rejectedResults, growiCommand.responseUrl);
    } catch (err) {
      logger.error(err);
    }
  }

  @Post('/commands')
  @UseBefore(
    AddSigningSecretToReq,
    verifySlackRequest,
    AuthorizeCommandMiddleware,
  )
  async handleCommand(
    @Req() req: SlackOauthReq,
    @Res() res: Res,
    // biome-ignore lint/suspicious/noConfusingVoidType: TODO: fix in https://redmine.weseek.co.jp/issues/168174
  ): Promise<void | string | Res | WebAPICallResult> {
    const { body, authorizeResult } = req;

    // retrieve bot token
    const { botToken } = authorizeResult;
    if (botToken == null) {
      const serverUri = process.env.SERVER_URI;
      res.json({
        blocks: [
          markdownSectionBlock('*Installation might be failed.*'),
          markdownSectionBlock(
            `Access to ${serverUri} and re-install GROWI App`,
          ),
        ],
      });
    }

    // parse /growi command
    let growiCommand: GrowiCommand;
    try {
      growiCommand = parseSlashCommand(body);
    } catch (err) {
      if (err instanceof InvalidGrowiCommandError) {
        res.json({
          blocks: [
            markdownSectionBlock('*Command type is not specified.*'),
            markdownSectionBlock(
              'Run `/growi help` to check the commands you can use.',
            ),
          ],
        });
      }
      logger.error(err.message);
      return;
    }

    // Send response immediately to avoid opelation_timeout error
    // See https://api.slack.com/apis/connections/events-api#the-events-api__responding-to-events
    res.json();

    // register
    if (this.registerService.shouldHandleCommand(growiCommand)) {
      return this.registerService.processCommand(
        growiCommand,
        authorizeResult,
        body,
      );
    }

    // unregister
    if (this.unregisterService.shouldHandleCommand(growiCommand)) {
      return this.unregisterService.processCommand(
        growiCommand,
        authorizeResult,
      );
    }

    // get relations
    const installationId =
      authorizeResult.enterpriseId || authorizeResult.teamId;
    const installation =
      await this.installationRepository.findByTeamIdOrEnterpriseId(
        // biome-ignore lint/style/noNonNullAssertion: ignore
        installationId!,
      );
    const relations = await this.relationRepository
      .createQueryBuilder('relation')
      .where('relation.installationId = :id', { id: installation?.id })
      .leftJoinAndSelect('relation.installation', 'installation')
      .getMany();

    if (relations.length === 0) {
      return respond(growiCommand.responseUrl, {
        blocks: [
          markdownSectionBlock('*No relation found.*'),
          markdownSectionBlock('Run `/growi register` first.'),
        ],
      });
    }

    // status
    if (growiCommand.growiCommandType === 'status') {
      return respond(growiCommand.responseUrl, {
        blocks: [
          markdownSectionBlock('*Found Relations to GROWI.*'),
          ...relations.map((relation) =>
            markdownSectionBlock(`GROWI url: ${relation.growiUri}`),
          ),
        ],
      });
    }

    // not supported commands
    if (!supportedGrowiCommands.includes(growiCommand.growiCommandType)) {
      return respond(growiCommand.responseUrl, {
        text: 'Command is not supported',
        blocks: [
          markdownSectionBlock('*Command is not supported*'),
          // eslint-disable-next-line max-len
          markdownSectionBlock(
            `\`/growi ${growiCommand.growiCommandType}\` command is not supported in this version of GROWI bot. Run \`/growi help\` to see all supported commands.`,
          ),
        ],
      });
    }

    // help
    if (growiCommand.growiCommandType === 'help') {
      return this.sendCommand(growiCommand, relations, body);
    }

    const allowedRelationsForSingleUse: Relation[] = [];
    const allowedRelationsForBroadcastUse: Relation[] = [];
    const disallowedGrowiUrls: Set<string> = new Set();

    const channel: IChannelOptionalId = {
      id: body.channel_id,
      name: body.channel_name,
    };

    // check permission
    await Promise.all(
      relations.map(async (relation) => {
        const isSupportedForSingleUse =
          await this.relationsService.isPermissionsForSingleUseCommands(
            relation,
            growiCommand.growiCommandType,
            channel,
          );

        let isSupportedForBroadcastUse = false;
        if (!isSupportedForSingleUse) {
          isSupportedForBroadcastUse =
            await this.relationsService.isPermissionsUseBroadcastCommands(
              relation,
              growiCommand.growiCommandType,
              channel,
            );
        }

        if (isSupportedForSingleUse) {
          allowedRelationsForSingleUse.push(relation);
        } else if (isSupportedForBroadcastUse) {
          allowedRelationsForBroadcastUse.push(relation);
        } else {
          disallowedGrowiUrls.add(relation.growiUri);
        }
      }),
    );

    // when all of GROWI disallowed
    if (relations.length === disallowedGrowiUrls.size) {
      const linkUrlList = Array.from(disallowedGrowiUrls).map((growiUrl) => {
        return `\n• ${new URL('/admin/slack-integration', growiUrl).toString()}`;
      });

      const growiDocsLink =
        'https://docs.growi.org/en/admin-guide/upgrading/43x.html';

      return respond(growiCommand.responseUrl, {
        text: 'Command not permitted.',
        blocks: [
          markdownSectionBlock('*None of GROWI permitted the command.*'),
          markdownSectionBlock(
            `*'${growiCommand.growiCommandType}'* command was not allowed.`,
          ),
          markdownSectionBlock(
            `To use this command, modify settings from following pages: ${linkUrlList}`,
          ),
          markdownSectionBlock(
            `Or, if your GROWI version is 4.3.0 or below, upgrade GROWI to use commands and permission settings: ${growiDocsLink}`,
          ),
        ],
      });
    }

    // select GROWI
    if (allowedRelationsForSingleUse.length > 0) {
      body.growiUrisForSingleUse = allowedRelationsForSingleUse.map(
        (v) => v.growiUri,
      );
      return this.selectGrowiService.processCommand(
        growiCommand,
        authorizeResult,
        body,
      );
    }

    // forward to GROWI server
    if (allowedRelationsForBroadcastUse.length > 0) {
      return this.sendCommand(
        growiCommand,
        allowedRelationsForBroadcastUse,
        body,
      );
    }
  }

  @Post('/interactions')
  @UseBefore(
    AddSigningSecretToReq,
    verifySlackRequest,
    parseSlackInteractionRequest,
    AuthorizeInteractionMiddleware,
    ExtractGrowiUriFromReq,
  )
  async handleInteraction(
    @Req() req: SlackOauthReq,
    @Res() res: Res,
    // biome-ignore lint/suspicious/noConfusingVoidType: TODO: fix in https://redmine.weseek.co.jp/issues/168174
  ): Promise<void | string | Res | WebAPICallResult> {
    logger.info('receive interaction', req.authorizeResult);
    logger.debug('receive interaction', req.body);

    const {
      body,
      authorizeResult,
      interactionPayload,
      interactionPayloadAccessor,
      growiUri,
    } = req;

    // pass
    if (body.ssl_check != null) {
      return;
    }
    if (interactionPayload == null) {
      return;
    }

    // register
    const registerResult = await this.registerService.processInteraction(
      authorizeResult,
      interactionPayload,
      interactionPayloadAccessor,
    );
    if (registerResult.isTerminated) return;
    // unregister
    const unregisterResult = await this.unregisterService.processInteraction(
      authorizeResult,
      interactionPayload,
      interactionPayloadAccessor,
    );
    if (unregisterResult.isTerminated) return;

    // immediate response to slack
    res.send();

    // select growi
    const selectGrowiResult = await this.selectGrowiService.processInteraction(
      authorizeResult,
      interactionPayload,
      interactionPayloadAccessor,
    );
    const selectedGrowiInformation = selectGrowiResult.result;
    if (!selectGrowiResult.isTerminated && selectedGrowiInformation != null) {
      return this.sendCommand(
        selectedGrowiInformation.growiCommand,
        [selectedGrowiInformation.relation],
        selectedGrowiInformation.sendCommandBody,
      );
    }

    // check permission
    const installationId =
      authorizeResult.enterpriseId || authorizeResult.teamId;
    const installation =
      await this.installationRepository.findByTeamIdOrEnterpriseId(
        // biome-ignore lint/style/noNonNullAssertion: ignore
        installationId!,
      );
    const relations = await this.relationRepository
      .createQueryBuilder('relation')
      .where('relation.installationId = :id', { id: installation?.id })
      .andWhere('relation.growiUri = :uri', { uri: growiUri })
      .leftJoinAndSelect('relation.installation', 'installation')
      .getMany();

    if (relations.length === 0) {
      return respond(interactionPayloadAccessor.getResponseUrl(), {
        blocks: [
          markdownSectionBlock('*No relation found.*'),
          markdownSectionBlock('Run `/growi register` first.'),
        ],
      });
    }

    const { actionId, callbackId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();

    const privateMeta = interactionPayloadAccessor.getViewPrivateMetaData();

    const channelFromMeta = {
      name: privateMeta?.body?.channel_name || privateMeta?.channelName,
    };

    const channel: IChannelOptionalId =
      interactionPayload.channel || channelFromMeta;
    const permission =
      await this.relationsService.checkPermissionForInteractions(
        relations,
        actionId,
        callbackId,
        channel,
      );

    const {
      allowedRelations,
      disallowedGrowiUrls,
      commandName,
      rejectedResults,
    } = permission;

    try {
      await respondRejectedErrors(
        rejectedResults,
        interactionPayloadAccessor.getResponseUrl(),
      );
    } catch (err) {
      logger.error(err);
    }

    if (relations.length === disallowedGrowiUrls.size) {
      return postNotAllowedMessage(
        interactionPayloadAccessor.getResponseUrl(),
        disallowedGrowiUrls,
        commandName,
      );
    }

    /*
     * forward to GROWI server
     */
    allowedRelations.map(async (relation) => {
      try {
        // generate API URL
        const url = new URL(
          '/_api/v3/slack-integration/proxied/interactions',
          relation.growiUri,
        );
        await axios.post(
          url.toString(),
          {
            ...body,
          },
          {
            headers: {
              'x-growi-ptog-tokens': relation.tokenPtoG,
            },
          },
        );
      } catch (err) {
        logger.error(err);
      }
    });
  }

  @Post('/events')
  @UseBefore(
    UrlVerificationMiddleware,
    AddSigningSecretToReq,
    verifySlackRequest,
    AuthorizeEventsMiddleware,
  )
  async handleEvent(@Req() req: SlackOauthReq): Promise<void> {
    const { authorizeResult } = req;
    const client = generateWebClient(authorizeResult.botToken);
    const { event } = req.body;

    // send welcome message
    if (event.type === 'app_home_opened') {
      try {
        await postWelcomeMessageOnce(client, event.channel);
      } catch (err) {
        logger.error('Failed to post welcome message', err);
      }
    }

    // unfurl
    if (this.linkSharedService.shouldHandleEvent(event.type)) {
      await this.linkSharedService.processEvent(client, event);
    }

    return;
  }

  @Get('/oauth_redirect')
  async handleOauthRedirect(
    @Req() req: Req,
    @Res() serverRes: ServerResponse,
    @Res() platformRes: PlatformResponse,
  ): Promise<string> {
    // create 'Add to Slack' url
    const addToSlackUrl =
      await this.installerService.installer.generateInstallUrl({
        scopes: requiredScopes,
      });

    const state = req.query.state;
    if (state == null || state === '') {
      return platformRes
        .status(400)
        .render('install-failed.ejs', { url: addToSlackUrl });
    }

    // promisify
    const installPromise = new Promise<Installation>((resolve, reject) => {
      this.installerService.installer.handleCallback(req, serverRes, {
        success: async (installation, metadata) => {
          logger.info('Success to install', { installation, metadata });
          resolve(installation);
        },
        failure: async (error) => {
          reject(error); // go to catch block
        },
      });
    });

    let httpStatus = 200;
    let httpBody: string | undefined;
    try {
      const installation = await installPromise;

      // check whether bot is not null
      if (installation.bot == null) {
        logger.warn(
          'Success to install but something wrong. `installation.bot` is null.',
        );
        httpStatus = 500;
        httpBody = await platformRes.render(
          'install-succeeded-but-has-problem.ejs',
          { reason: '`installation.bot` is null' },
        );
      }
      // MAIN PATH: everything is fine
      else {
        const appPageUrl = `https://slack.com/apps/${installation.appId}`;
        httpBody = await platformRes.render('install-succeeded.ejs', {
          appPageUrl,
        });

        // generate client
        const client = generateWebClient(installation.bot.token);

        const userId = installation.user.id;

        await Promise.all([
          // post message
          postInstallSuccessMessage(client, userId),
          // publish home
          // TODO: When Home tab show off, use bellow.
          // publishInitialHomeView(client, userId),
        ]);
      }
    } catch (error) {
      logger.error(error);
      httpStatus = 500;
      httpBody = await platformRes
        .status(400)
        .render('install-failed.ejs', { url: addToSlackUrl });
    }

    platformRes.status(httpStatus);
    return httpBody;
  }
}
