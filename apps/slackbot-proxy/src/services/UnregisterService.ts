import type {
  GrowiCommand,
  GrowiCommandProcessor,
  GrowiInteractionProcessor,
  InteractionHandledResult,
} from '@growi/slack';
import {
  actionsBlock,
  buttonElement,
  inputBlock,
  markdownSectionBlock,
} from '@growi/slack/dist/utils/block-kit-builder';
import { InteractionPayloadAccessor } from '@growi/slack/dist/utils/interaction-payload-accessor';
import { getInteractionIdRegexpFromCommandName } from '@growi/slack/dist/utils/payload-interaction-id-helpers';
import { replaceOriginal, respond } from '@growi/slack/dist/utils/response-url';
import { AuthorizeResult } from '@slack/oauth';
import { MultiStaticSelect } from '@slack/web-api';
import { Inject, Service } from '@tsed/di';
import axios from 'axios';
import { DeleteResult } from 'typeorm';

import { Installation } from '~/entities/installation';
import { InstallationRepository } from '~/repositories/installation';
import { RelationRepository } from '~/repositories/relation';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('slackbot-proxy:services:UnregisterService');

@Service()
export class UnregisterService
  implements GrowiCommandProcessor, GrowiInteractionProcessor<void>
{
  @Inject()
  relationRepository: RelationRepository;

  @Inject()
  installationRepository: InstallationRepository;

  shouldHandleCommand(growiCommand: GrowiCommand): boolean {
    return growiCommand.growiCommandType === 'unregister';
  }

  async processCommand(
    growiCommand: GrowiCommand,
    authorizeResult: AuthorizeResult,
  ): Promise<void> {
    // get growi urls
    const installationId =
      authorizeResult.enterpriseId || authorizeResult.teamId;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const installation =
      await this.installationRepository.findByTeamIdOrEnterpriseId(
        installationId!,
      );
    const relations = await this.relationRepository
      .createQueryBuilder('relation')
      .where('relation.installationId = :id', { id: installation?.id })
      .leftJoinAndSelect('relation.installation', 'installation')
      .getMany();

    if (relations.length === 0) {
      await respond(growiCommand.responseUrl, {
        text: 'No GROWI found to unregister.',
        blocks: [
          markdownSectionBlock(
            "You haven't registered any GROWI to this workspace.",
          ),
          markdownSectionBlock('Send `/growi register` to register.'),
        ],
      });
      return;
    }

    const staticSelectElement: MultiStaticSelect = {
      action_id: 'unregister:selectedGrowiUris',
      type: 'multi_static_select',
      placeholder: {
        type: 'plain_text',
        text: 'Select GROWI URLs to unregister',
      },
      options: relations.map((relation) => {
        return {
          text: {
            type: 'plain_text',
            text: relation.growiUri,
          },
          value: relation.growiUri,
        };
      }),
    };

    await respond(growiCommand.responseUrl, {
      text: 'Select GROWI URLs to unregister.',
      blocks: [
        inputBlock(staticSelectElement, 'growiUris', 'GROWI URL to unregister'),
        actionsBlock(
          buttonElement({
            text: 'Cancel',
            actionId: 'unregister:cancel',
            value: JSON.stringify({}),
          }),
          buttonElement({
            text: 'Unregister',
            actionId: 'unregister:unregister',
            style: 'danger',
            value: JSON.stringify({}),
          }),
        ),
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
      getInteractionIdRegexpFromCommandName('unregister');
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

    const { actionId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();

    switch (actionId) {
      case 'unregister:unregister':
        interactionHandledResult.result =
          await this.handleUnregisterInteraction(
            authorizeResult,
            interactionPayload,
            interactionPayloadAccessor,
          );
        break;
      case 'unregister:cancel':
        interactionHandledResult.result =
          await this.handleUnregisterCancelInteraction(
            interactionPayloadAccessor,
          );
        break;
      case 'unregister:selectedGrowiUris':
        break;
      default:
        logger.error('This unregister interaction is not implemented.');
        break;
    }
    interactionHandledResult.isTerminated = true;

    return interactionHandledResult as InteractionHandledResult<void>;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async handleUnregisterInteraction(
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    authorizeResult: AuthorizeResult,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<void> {
    const responseUrl = interactionPayloadAccessor.getResponseUrl();

    const selectedOptions =
      interactionPayloadAccessor.getStateValues()?.growiUris?.[
        'unregister:selectedGrowiUris'
      ]?.selected_options;
    if (!Array.isArray(selectedOptions)) {
      logger.error('Unregisteration failed: Mulformed object was detected\n');
      await respond(responseUrl, {
        text: 'Unregistration failed',
        blocks: [
          markdownSectionBlock('Error occurred while unregistering GROWI.'),
        ],
      });
      return;
    }
    const growiUris = selectedOptions.map(
      (selectedOption) => selectedOption.value,
    );

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
      logger.error('Unregisteration failed:\n', err);
      await respond(responseUrl, {
        text: 'Unregistration failed',
        blocks: [
          markdownSectionBlock('Error occurred while unregistering GROWI.'),
        ],
      });
      return;
    }

    let deleteResult: DeleteResult;
    try {
      deleteResult = await this.relationRepository
        .createQueryBuilder('relation')
        .where('relation.growiUri IN (:uris)', { uris: growiUris })
        .andWhere('relation.installationId = :installationId', {
          installationId: installation?.id,
        })
        .delete()
        .execute();
    } catch (err) {
      logger.error('Unregisteration failed\n', err);
      await respond(responseUrl, {
        text: 'Unregistration failed',
        blocks: [
          markdownSectionBlock('Error occurred while unregistering GROWI.'),
        ],
      });
      return;
    }

    await replaceOriginal(responseUrl, {
      text: 'Unregistration completed',
      blocks: [
        markdownSectionBlock(
          `Unregistered *${deleteResult.affected}* GROWI from this workspace.`,
        ),
      ],
    });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async handleUnregisterCancelInteraction(
    interactionPayloadAccessor: InteractionPayloadAccessor,
  ): Promise<void> {
    await axios.post(interactionPayloadAccessor.getResponseUrl(), {
      delete_original: true,
    });
  }
}
