import type {
  GrowiCommand,
  GrowiCommandProcessor,
  GrowiInteractionProcessor,
  InteractionHandledResult,
} from '@growi/slack';
import {
  inputBlock,
  inputSectionBlock,
  markdownHeaderBlock,
  markdownSectionBlock,
} from '@growi/slack/dist/utils/block-kit-builder';
import { InteractionPayloadAccessor } from '@growi/slack/dist/utils/interaction-payload-accessor';
import { getInteractionIdRegexpFromCommandName } from '@growi/slack/dist/utils/payload-interaction-id-helpers';
import { respond } from '@growi/slack/dist/utils/response-url';
import { AuthorizeResult } from '@slack/oauth';
import {
  Block,
  ConversationsSelect,
  LogLevel,
  WebClient,
} from '@slack/web-api';
import { Inject, Service } from '@tsed/di';

import { InstallationRepository } from '~/repositories/installation';
import { OrderRepository } from '~/repositories/order';
import loggerFactory from '~/utils/logger';

import { InvalidUrlError } from '../models/errors';

const logger = loggerFactory('slackbot-proxy:services:RegisterService');

const isProduction = process.env.NODE_ENV === 'production';
const isOfficialMode = process.env.OFFICIAL_MODE === 'true';

export type RegisterCommandBody = {
  // eslint-disable-next-line camelcase
  trigger_id: string;
  // eslint-disable-next-line camelcase
  channel_name: string;
};

@Service()
export class RegisterService
  implements
    GrowiCommandProcessor<RegisterCommandBody>,
    GrowiInteractionProcessor<void>
{
  @Inject()
  orderRepository: OrderRepository;

  @Inject()
  installationRepository: InstallationRepository;

  shouldHandleCommand(growiCommand: GrowiCommand): boolean {
    return growiCommand.growiCommandType === 'register';
  }

  async processCommand(
    growiCommand: GrowiCommand,
    authorizeResult: AuthorizeResult,
    context: RegisterCommandBody,
  ): Promise<void> {
    const { botToken } = authorizeResult;

    const client = new WebClient(botToken, {
      logLevel: isProduction ? LogLevel.DEBUG : LogLevel.INFO,
    });

    const conversationsSelectElement: ConversationsSelect = {
      action_id: 'conversation',
      type: 'conversations_select',
      response_url_enabled: true,
      default_to_current_conversation: true,
    };
    await client.views.open({
      trigger_id: context.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'register:register',
        title: {
          type: 'plain_text',
          text: 'Register Credentials',
        },
        submit: {
          type: 'plain_text',
          text: 'Submit',
        },
        close: {
          type: 'plain_text',
          text: 'Close',
        },
        private_metadata: JSON.stringify({ channel: context.channel_name }),

        blocks: [
          inputBlock(
            conversationsSelectElement,
            'conversation',
            'Channel to which you want to add',
          ),
          inputSectionBlock(
            'growiUrl',
            'GROWI domain',
            'contents_input',
            false,
            'https://example.com',
          ),
          inputSectionBlock(
            'tokenPtoG',
            'Access Token Proxy to GROWI',
            'contents_input',
            false,
            'jBMZvpk.....',
          ),
          inputSectionBlock(
            'tokenGtoP',
            'Access Token GROWI to Proxy',
            'contents_input',
            false,
            'sdg15av.....',
          ),
        ],
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  shouldHandleInteraction(
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): boolean {
    const { actionId, callbackId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();
    const registerRegexp: RegExp =
      getInteractionIdRegexpFromCommandName('register');
    return registerRegexp.test(actionId) || registerRegexp.test(callbackId);
  }

  async processInteraction(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    authorizeResult: AuthorizeResult,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<InteractionHandledResult<void>> {
    const interactionHandledResult: InteractionHandledResult<void> = {
      isTerminated: false,
    };
    if (!this.shouldHandleInteraction(interactionPayloadAccessor))
      return interactionHandledResult;

    interactionHandledResult.result = await this.handleRegisterInteraction(
      authorizeResult,
      interactionPayload,
      interactionPayloadAccessor,
    );
    interactionHandledResult.isTerminated = true;

    return interactionHandledResult as InteractionHandledResult<void>;
  }

  async handleRegisterInteraction(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    authorizeResult: AuthorizeResult,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<void> {
    try {
      await this.insertOrderRecord(authorizeResult, interactionPayloadAccessor);
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        logger.error('Failed to register:\n', err);
        await respond(interactionPayloadAccessor.getResponseUrl(), {
          text: 'Invalid URL',
          blocks: [markdownSectionBlock('Please enter a valid URL')],
        });
        return;
      }

      logger.error('Error occurred while insertOrderRecord:\n', err);
    }

    await this.notifyServerUriToSlack(interactionPayloadAccessor);
  }

  async insertOrderRecord(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    authorizeResult: AuthorizeResult,
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<void> {
    const inputValues = interactionPayloadAccessor.getStateValues();
    const growiUrl = inputValues.growiUrl.contents_input.value;
    const tokenPtoG = inputValues.tokenPtoG.contents_input.value;
    const tokenGtoP = inputValues.tokenGtoP.contents_input.value;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const url = new URL(growiUrl);
    } catch (error) {
      throw new InvalidUrlError(growiUrl);
    }

    const installationId =
      authorizeResult.enterpriseId || authorizeResult.teamId;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const installation =
      await this.installationRepository.findByTeamIdOrEnterpriseId(
        installationId!,
      );

    this.orderRepository.save({
      installation,
      growiUrl,
      tokenPtoG,
      tokenGtoP,
    });
  }

  async notifyServerUriToSlack(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<void> {
    const serverUri = process.env.SERVER_URI;
    const responseUrl = interactionPayloadAccessor.getResponseUrl();

    const blocks: Block[] = [];

    if (isOfficialMode) {
      blocks.push(
        markdownHeaderBlock(
          ':white_check_mark: 1. Install Official bot to Slack',
        ),
      );
      blocks.push(
        markdownHeaderBlock(
          ':white_check_mark: 2. Register for GROWI Official Bot Proxy Service',
        ),
      );
      blocks.push(
        markdownSectionBlock(
          'The request has been successfully accepted. However, registration has *NOT been completed* yet.',
        ),
      );
      blocks.push(markdownHeaderBlock(':arrow_right: 3. Test Connection'));
      blocks.push(
        markdownSectionBlock(
          '*Test Connection* to complete the registration in your GROWI.',
        ),
      );
      blocks.push(
        markdownHeaderBlock(':white_large_square: 4. (Opt) Manage Permission'),
      );
      blocks.push(
        markdownSectionBlock('Modify permission settings if you need.'),
      );
      await respond(responseUrl, {
        text: 'Proxy URL',
        blocks,
      });
      return;
    }

    blocks.push(markdownHeaderBlock(':white_check_mark: 1. Create Bot'));
    blocks.push(
      markdownHeaderBlock(':white_check_mark: 2. Install bot to Slack'),
    );
    blocks.push(
      markdownHeaderBlock(
        ':white_check_mark: 3. Register for your GROWI Custom Bot Proxy',
      ),
    );
    blocks.push(
      markdownSectionBlock(
        'The request has been successfully accepted. However, registration has *NOT been completed* yet.',
      ),
    );
    blocks.push(markdownHeaderBlock(':arrow_right: 4. Set Proxy URL on GROWI'));
    blocks.push(
      markdownSectionBlock(
        'Please enter and update the following Proxy URL to slack bot setting form in your GROWI',
      ),
    );
    blocks.push(markdownSectionBlock(`Proxy URL: ${serverUri}`));
    blocks.push(markdownHeaderBlock(':arrow_right: 5. Test Connection'));
    blocks.push(
      markdownSectionBlock(
        'And *Test Connection* to complete the registration in your GROWI.',
      ),
    );
    blocks.push(
      markdownHeaderBlock(':white_large_square: 6. (Opt) Manage Permission'),
    );
    blocks.push(
      markdownSectionBlock('Modify permission settings if you need.'),
    );
    await respond(responseUrl, {
      text: 'Proxy URL',
      blocks,
    });
    return;
  }
}
