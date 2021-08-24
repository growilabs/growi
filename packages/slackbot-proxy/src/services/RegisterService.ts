import { Inject, Service } from '@tsed/di';
import { WebClient, LogLevel, Block } from '@slack/web-api';
import {
  markdownSectionBlock, markdownHeaderBlock, inputSectionBlock, GrowiCommand,
} from '@growi/slack';
import { AuthorizeResult } from '@slack/oauth';
import { GrowiCommandProcessor } from '~/interfaces/slack-to-growi/growi-command-processor';
import { OrderRepository } from '~/repositories/order';
import { Installation } from '~/entities/installation';
import { InvalidUrlError } from '../models/errors';

const isProduction = process.env.NODE_ENV === 'production';
const isOfficialMode = process.env.OFFICIAL_MODE === 'true';

@Service()
export class RegisterService implements GrowiCommandProcessor {

  @Inject()
  orderRepository: OrderRepository;

  async process(growiCommand: GrowiCommand, authorizeResult: AuthorizeResult, body: {[key:string]:string}): Promise<void> {
    const { botToken } = authorizeResult;

    const client = new WebClient(botToken, { logLevel: isProduction ? LogLevel.DEBUG : LogLevel.INFO });
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'register',
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
        private_metadata: JSON.stringify({ channel: body.channel_name }),

        blocks: [
          inputSectionBlock('growiUrl', 'GROWI domain', 'contents_input', false, 'https://example.com'),
          inputSectionBlock('tokenPtoG', 'Access Token Proxy to GROWI', 'contents_input', false, 'jBMZvpk.....'),
          inputSectionBlock('tokenGtoP', 'Access Token GROWI to Proxy', 'contents_input', false, 'sdg15av.....'),
        ],
      },
    });
  }

  async replyToSlack(client: WebClient, channel: string, user: string, text: string, blocks: Array<Block>): Promise<void> {
    await client.chat.postEphemeral({
      channel,
      user,
      // Recommended including 'text' to provide a fallback when using blocks
      // refer to https://api.slack.com/methods/chat.postEphemeral#text_usage
      text,
      blocks,
    });
    return;
  }

  async insertOrderRecord(
      installation: Installation | undefined,
      // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
      botToken: string | undefined, payload: any,
  ): Promise<void> {
    const inputValues = payload.view.state.values;
    const growiUrl = inputValues.growiUrl.contents_input.value;
    const tokenPtoG = inputValues.tokenPtoG.contents_input.value;
    const tokenGtoP = inputValues.tokenGtoP.contents_input.value;

    const { channel } = JSON.parse(payload.view.private_metadata);

    const client = new WebClient(botToken, { logLevel: isProduction ? LogLevel.DEBUG : LogLevel.INFO });

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const url = new URL(growiUrl);
    }
    catch (error) {
      const invalidErrorMsg = 'Please enter a valid URL';
      const blocks = [
        markdownSectionBlock(invalidErrorMsg),
      ];
      await this.replyToSlack(client, channel, payload.user.id, 'Invalid URL', blocks);
      throw new InvalidUrlError(growiUrl);
    }

    this.orderRepository.save({
      installation, growiUrl, tokenPtoG, tokenGtoP,
    });
  }

  async notifyServerUriToSlack(
      // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
      botToken: string | undefined, payload: any,
  ): Promise<void> {

    const { channel } = JSON.parse(payload.view.private_metadata);

    const serverUri = process.env.SERVER_URI;

    const client = new WebClient(botToken, { logLevel: isProduction ? LogLevel.DEBUG : LogLevel.INFO });

    const blocks: Block[] = [];

    if (isOfficialMode) {
      blocks.push(markdownHeaderBlock(':white_check_mark: 1. Install Official bot to Slack'));
      blocks.push(markdownHeaderBlock(':white_check_mark: 2. Register for GROWI Official Bot Proxy Service'));
      blocks.push(markdownSectionBlock('The request has been successfully accepted. However, registration has *NOT been completed* yet.'));
      blocks.push(markdownHeaderBlock(':arrow_right: 3. Test Connection'));
      blocks.push(markdownSectionBlock('*Test Connection* to complete the registration in your GROWI.'));
      blocks.push(markdownHeaderBlock(':white_large_square: 4. (Opt) Manage GROWI commands'));
      blocks.push(markdownSectionBlock('Modify permission settings if you need.'));
      await this.replyToSlack(client, channel, payload.user.id, 'Proxy URL', blocks);
      return;

    }

    blocks.push(markdownHeaderBlock(':white_check_mark: 1. Create Bot'));
    blocks.push(markdownHeaderBlock(':white_check_mark: 2. Install bot to Slack'));
    blocks.push(markdownHeaderBlock(':white_check_mark: 3. Register for your GROWI Custom Bot Proxy'));
    blocks.push(markdownSectionBlock('The request has been successfully accepted. However, registration has *NOT been completed* yet.'));
    blocks.push(markdownHeaderBlock(':arrow_right: 4. Set Proxy URL on GROWI'));
    blocks.push(markdownSectionBlock('Please enter and update the following Proxy URL to slack bot setting form in your GROWI'));
    blocks.push(markdownSectionBlock(`Proxy URL: ${serverUri}`));
    blocks.push(markdownHeaderBlock(':arrow_right: 5. Test Connection'));
    blocks.push(markdownSectionBlock('And *Test Connection* to complete the registration in your GROWI.'));
    blocks.push(markdownHeaderBlock(':white_large_square: 6. (Opt) Manage GROWI commands'));
    blocks.push(markdownSectionBlock('Modify permission settings if you need.'));
    await this.replyToSlack(client, channel, payload.user.id, 'Proxy URL', blocks);
    return;
  }

}
