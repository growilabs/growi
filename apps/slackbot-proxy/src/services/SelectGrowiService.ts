import type {
  GrowiCommand,
  GrowiCommandProcessor,
  GrowiInteractionProcessor,
  InteractionHandledResult,
} from '@growi/slack';
import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import { InteractionPayloadAccessor } from '@growi/slack/dist/utils/interaction-payload-accessor';
import { getInteractionIdRegexpFromCommandName } from '@growi/slack/dist/utils/payload-interaction-id-helpers';
import { replaceOriginal, respond } from '@growi/slack/dist/utils/response-url';
import { AuthorizeResult } from '@slack/oauth';
import { Inject, Service } from '@tsed/di';

import { Installation } from '~/entities/installation';
import { Relation } from '~/entities/relation';
import { InstallationRepository } from '~/repositories/installation';
import { RelationRepository } from '~/repositories/relation';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('slackbot-proxy:services:UnregisterService');

export type SelectGrowiCommandBody = {
  growiUrisForSingleUse: string[];
};

type SelectValue = {
  growiCommand: GrowiCommand;
  growiUri: any;
};

type SendCommandBody = {
  // eslint-disable-next-line camelcase
  trigger_id: string;
  // eslint-disable-next-line camelcase
  channel_id: string;
  // eslint-disable-next-line camelcase
  channel_name: string;
};

export type SelectedGrowiInformation = {
  relation: Relation;
  growiCommand: GrowiCommand;
  sendCommandBody: SendCommandBody;
};

@Service()
export class SelectGrowiService
  implements
    GrowiCommandProcessor<SelectGrowiCommandBody | null>,
    GrowiInteractionProcessor<SelectedGrowiInformation>
{
  @Inject()
  relationRepository: RelationRepository;

  @Inject()
  installationRepository: InstallationRepository;

  private generateGrowiSelectValue(
    growiCommand: GrowiCommand,
    growiUri: string,
  ): SelectValue {
    return {
      growiCommand,
      growiUri,
    };
  }

  shouldHandleCommand(): boolean {
    // TODO: consider to use the default supported commands for single use
    return true;
  }

  async processCommand(
    growiCommand: GrowiCommand,
    authorizeResult: AuthorizeResult,
    context: SelectGrowiCommandBody,
  ): Promise<void> {
    const growiUrls = context.growiUrisForSingleUse;

    const chooseSection = growiUrls.map((growiUri) => {
      const value = this.generateGrowiSelectValue(growiCommand, growiUri);
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: growiUri,
        },
        accessory: {
          type: 'button',
          action_id: 'select_growi:select_growi',
          text: {
            type: 'plain_text',
            text: 'Choose',
          },
          value: JSON.stringify(value),
        },
      };
    });

    return respond(growiCommand.responseUrl, {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Select target GROWI',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Request: \`/growi ${growiCommand.text}\` to:`,
            },
          ],
        },
        {
          type: 'divider',
        },
        ...chooseSection,
      ],
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  shouldHandleInteraction(
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): boolean {
    const { actionId, callbackId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();
    const registerRegexp: RegExp =
      getInteractionIdRegexpFromCommandName('select_growi');
    return registerRegexp.test(actionId) || registerRegexp.test(callbackId);
  }

  async processInteraction(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    authorizeResult: AuthorizeResult,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<InteractionHandledResult<SelectedGrowiInformation>> {
    const interactionHandledResult: InteractionHandledResult<SelectedGrowiInformation> =
      {
        isTerminated: false,
      };
    if (!this.shouldHandleInteraction(interactionPayloadAccessor))
      return interactionHandledResult;

    const selectGrowiInformation = await this.handleSelectInteraction(
      authorizeResult,
      interactionPayload,
      interactionPayloadAccessor,
    );
    if (selectGrowiInformation != null) {
      interactionHandledResult.result = selectGrowiInformation;
    }
    interactionHandledResult.isTerminated = false;

    return interactionHandledResult as InteractionHandledResult<SelectedGrowiInformation>;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async handleSelectInteraction(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    authorizeResult: AuthorizeResult,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<SelectedGrowiInformation | null> {
    const responseUrl = interactionPayloadAccessor.getResponseUrl();

    const selectGrowiValue = interactionPayloadAccessor.firstAction()?.value;
    if (selectGrowiValue == null) {
      logger.error(
        'GROWI command failed: The first action element must have the value parameter.',
      );
      await respond(responseUrl, {
        text: 'GROWI command failed',
        blocks: [
          markdownSectionBlock(
            'Error occurred while processing GROWI command.',
          ),
        ],
      });
      return null;
    }
    const { growiUri, growiCommand } = JSON.parse(selectGrowiValue);

    if (growiCommand == null) {
      logger.error(
        'GROWI command failed: The first action value must have growiCommand parameter.',
      );
      await respond(responseUrl, {
        text: 'GROWI command failed',
        blocks: [
          markdownSectionBlock(
            'Error occurred while processing GROWI command.',
          ),
        ],
      });
      return null;
    }

    await replaceOriginal(responseUrl, {
      text: `Accepted ${growiCommand.growiCommandType} command.`,
      blocks: [
        markdownSectionBlock(
          `Forwarding your request *"/growi ${growiCommand.growiCommandType}"* on GROWI to ${growiUri} ...`,
        ),
      ],
    });

    const installationId =
      authorizeResult.enterpriseId || authorizeResult.teamId;
    let installation: Installation | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      installation =
        await this.installationRepository.findByTeamIdOrEnterpriseId(
          installationId!,
        );
    } catch (err) {
      logger.error('GROWI command failed: No installation found.\n', err);
      await respond(responseUrl, {
        text: 'GROWI command failed',
        blocks: [
          markdownSectionBlock(
            'Error occurred while processing GROWI command.',
          ),
        ],
      });
      return null;
    }

    const relation = await this.relationRepository
      .createQueryBuilder('relation')
      .where('relation.growiUri =:growiUri', { growiUri })
      .andWhere('relation.installationId = :id', { id: installation?.id })
      .leftJoinAndSelect('relation.installation', 'installation')
      .getOne();

    if (relation == null) {
      logger.error('GROWI command failed: No installation found.');
      await respond(responseUrl, {
        text: 'GROWI command failed',
        blocks: [
          markdownSectionBlock(
            'Error occurred while processing GROWI command.',
          ),
        ],
      });
      return null;
    }

    // increment sendCommandBody
    const channel = interactionPayloadAccessor.getChannel();
    if (channel == null) {
      logger.error('GROWI command failed: channel not found.');
      await respond(responseUrl, {
        text: 'GROWI command failed',
        blocks: [
          markdownSectionBlock(
            'Error occurred while processing GROWI command.',
          ),
        ],
      });
      return null;
    }
    const sendCommandBody: SendCommandBody = {
      trigger_id: interactionPayload.trigger_id,
      channel_id: channel.id,
      channel_name: channel.name,
    };

    return {
      relation,
      growiCommand,
      sendCommandBody,
    };
  }
}
