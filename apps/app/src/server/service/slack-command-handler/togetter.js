import {
  actionsBlock,
  buttonElement,
  divider,
  inputBlock,
  markdownSectionBlock,
} from '@growi/slack/dist/utils/block-kit-builder';
import { deleteOriginal, respond } from '@growi/slack/dist/utils/response-url';
import { format, formatDate } from 'date-fns/format';
import { parse } from 'date-fns/parse';

import { SlackCommandHandlerError } from '~/server/models/vo/slack-command-handler-error';
import loggerFactory from '~/utils/logger';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:service:SlackBotService:togetter');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const CreatePageService = require('./create-page-service');
  const createPageService = new CreatePageService(crowi);
  const BaseSlackCommandHandler = require('./slack-command-handler');
  const handler = new BaseSlackCommandHandler();

  handler.handleCommand = async function (growiCommand, client, body) {
    await respond(growiCommand.responseUrl, {
      text: 'Select messages to use.',
      blocks: this.togetterMessageBlocks(),
    });
    return;
  };

  handler.handleInteractions = async function (
    client,
    interactionPayload,
    interactionPayloadAccessor,
    handlerMethodName,
  ) {
    await this[handlerMethodName](
      client,
      interactionPayload,
      interactionPayloadAccessor,
    );
  };

  handler.cancel = async (client, payload, interactionPayloadAccessor) => {
    await deleteOriginal(interactionPayloadAccessor.getResponseUrl(), {
      delete_original: true,
    });
  };

  handler.createPage = async function (
    client,
    payload,
    interactionPayloadAccessor,
  ) {
    let result = [];
    const channelId = payload.channel.id; // this must exist since the type is always block_actions
    const userChannelId = payload.user.id;

    // validate form
    const { path, oldest, newest } = await this.togetterValidateForm(
      client,
      payload,
      interactionPayloadAccessor,
    );
    // get messages
    result = await this.togetterGetMessages(client, channelId, newest, oldest);
    // clean messages
    const cleanedContents = await this.togetterCleanMessages(result.messages);

    const contentsBody = cleanedContents.join('');
    // create and send url message
    await this.togetterCreatePageAndSendPreview(
      client,
      interactionPayloadAccessor,
      path,
      userChannelId,
      contentsBody,
    );
  };

  handler.togetterValidateForm = async (
    client,
    payload,
    interactionPayloadAccessor,
  ) => {
    const grwTzoffset = crowi.appService.getTzoffset() * 60;
    const path =
      interactionPayloadAccessor.getStateValues()?.page_path.page_path.value;
    let oldest =
      interactionPayloadAccessor.getStateValues()?.oldest.oldest.value;
    let newest =
      interactionPayloadAccessor.getStateValues()?.newest.newest.value;

    if (oldest == null || newest == null || path == null) {
      throw new SlackCommandHandlerError(
        'All parameters are required. (Oldest datetime, Newst datetime and Page path)',
      );
    }

    /**
     * RegExp for datetime yyyy/MM/dd-HH:mm
     * @see https://regex101.com/r/XbxdNo/1
     */
    const regexpDatetime = new RegExp(
      /^[12]\d\d\d\/(0[1-9]|1[012])\/(0[1-9]|[12][0-9]|3[01])-([01][0-9]|2[0123]):[0-5][0-9]$/,
    );

    if (!regexpDatetime.test(oldest.trim())) {
      throw new SlackCommandHandlerError(
        'Datetime format for oldest must be yyyy/MM/dd-HH:mm',
      );
    }
    if (!regexpDatetime.test(newest.trim())) {
      throw new SlackCommandHandlerError(
        'Datetime format for newest must be yyyy/MM/dd-HH:mm',
      );
    }
    oldest =
      parse(oldest, 'yyyy/MM/dd-HH:mm', new Date()).getTime() / 1000 +
      grwTzoffset;
    // + 60s in order to include messages between hh:mm.00s and hh:mm.59s
    newest =
      parse(newest, 'yyyy/MM/dd-HH:mm', new Date()).getTime() / 1000 +
      grwTzoffset +
      60;

    if (oldest > newest) {
      throw new SlackCommandHandlerError(
        'Oldest datetime must be older than the newest date time.',
      );
    }

    return { path, oldest, newest };
  };

  async function retrieveHistory(client, channelId, newest, oldest) {
    return client.conversations.history({
      channel: channelId,
      newest,
      oldest,
      limit: 100,
      inclusive: true,
    });
  }

  handler.togetterGetMessages = async (client, channelId, newest, oldest) => {
    let result;

    // first attempt
    try {
      result = await retrieveHistory(client, channelId, newest, oldest);
    } catch (err) {
      const errorCode = err.data?.errorCode;

      if (errorCode === 'not_in_channel') {
        // join and retry
        await client.conversations.join({
          channel: channelId,
        });
        result = await retrieveHistory(client, channelId, newest, oldest);
      } else if (errorCode === 'channel_not_found') {
        const message =
          ":cry: GROWI Bot couldn't get history data because *this channel was private*." +
          '\nPlease add GROWI bot to this channel.' +
          '\n';
        throw new SlackCommandHandlerError(message, {
          respondBody: {
            text: message,
            blocks: [
              markdownSectionBlock(message),
              {
                type: 'image',
                image_url:
                  'https://user-images.githubusercontent.com/1638767/135834548-2f6b8ce6-30a7-4d47-9fdc-a58ddd692b7e.png',
                alt_text: 'Add app to this channel',
              },
            ],
          },
        });
      } else {
        throw err;
      }
    }

    // return if no message found
    if (result.messages.length === 0) {
      throw new SlackCommandHandlerError(
        'No message found from togetter command. Try different datetime.',
      );
    }
    return result;
  };

  handler.togetterCleanMessages = async (messages) => {
    const cleanedContents = [];
    let lastMessage = {};
    const grwTzoffset = crowi.appService.getTzoffset() * 60;
    messages
      .sort((a, b) => {
        return a.ts - b.ts;
      })
      .forEach((message) => {
        // increment contentsBody while removing the same headers
        // exclude header
        const lastMessageTs = Math.floor(lastMessage.ts / 60);
        const messageTs = Math.floor(message.ts / 60);
        if (lastMessage.user === message.user && lastMessageTs === messageTs) {
          cleanedContents.push(`${message.text}\n`);
        }
        // include header
        else {
          const ts = (parseInt(message.ts) - grwTzoffset) * 1000;
          const time = formatDate(new Date(ts), 'h:mm a');
          cleanedContents.push(`${message.user}  ${time}\n${message.text}\n`);
          lastMessage = message;
        }
      });
    return cleanedContents;
  };

  handler.togetterCreatePageAndSendPreview = async (
    client,
    interactionPayloadAccessor,
    path,
    userChannelId,
    contentsBody,
  ) => {
    await createPageService.createPageInGrowi(
      interactionPayloadAccessor,
      path,
      contentsBody,
    );

    // send preview to dm
    await client.chat.postMessage({
      channel: userChannelId,
      text: 'Preview from togetter command',
      blocks: [
        markdownSectionBlock('*Preview*'),
        divider(),
        markdownSectionBlock(contentsBody),
        divider(),
      ],
    });
    // dismiss
    await deleteOriginal(interactionPayloadAccessor.getResponseUrl(), {
      delete_original: true,
    });
  };

  handler.togetterMessageBlocks = function () {
    return [
      markdownSectionBlock(
        'Select the oldest and newest datetime of the messages to use.',
      ),
      inputBlock(
        this.plainTextInputElementWithInitialTime('oldest'),
        'oldest',
        'Oldest datetime',
      ),
      inputBlock(
        this.plainTextInputElementWithInitialTime('newest'),
        'newest',
        'Newest datetime',
      ),
      inputBlock(
        this.togetterInputBlockElement('page_path', '/'),
        'page_path',
        'Page path',
      ),
      actionsBlock(
        buttonElement({ text: 'Cancel', actionId: 'togetter:cancel' }),
        buttonElement({
          text: 'Create page',
          actionId: 'togetter:createPage',
          style: 'primary',
        }),
      ),
    ];
  };

  /**
   * Plain-text input element
   * https://api.slack.com/reference/block-kit/block-elements#input
   */
  handler.togetterInputBlockElement = (
    actionId,
    placeholderText = 'Write something ...',
  ) => ({
    type: 'plain_text_input',
    placeholder: {
      type: 'plain_text',
      text: placeholderText,
    },
    action_id: actionId,
  });

  handler.plainTextInputElementWithInitialTime = (actionId) => {
    const tzDateSec = new Date().getTime();
    const grwTzoffset = crowi.appService.getTzoffset() * 60 * 1000;
    const initialDateTime = format(
      new Date(tzDateSec - grwTzoffset),
      'yyyy/MM/dd-HH:mm',
    );
    return {
      type: 'plain_text_input',
      action_id: actionId,
      initial_value: initialDateTime,
    };
  };

  return handler;
};
