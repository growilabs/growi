import {
  actionsBlock,
  buttonElement,
  inputBlock,
  markdownSectionBlock,
} from '@growi/slack/dist/utils/block-kit-builder';
import { format } from 'date-fns/format';
import { parse } from 'date-fns/parse';

import { SlackCommandHandlerError } from '~/server/models/vo/slack-command-handler-error';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:SlackBotService:keep');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const CreatePageService = require('./create-page-service');
  const createPageService = new CreatePageService(crowi);
  const BaseSlackCommandHandler = require('./slack-command-handler');
  const handler = new BaseSlackCommandHandler();
  const { User } = crowi.models;

  handler.handleCommand = async function (
    growiCommand,
    client,
    body,
    respondUtil,
  ) {
    await respondUtil.respond({
      text: 'Select messages to use.',
      blocks: this.keepMessageBlocks(body.channel_name),
    });
    return;
  };

  handler.handleInteractions = async function (
    client,
    interactionPayload,
    interactionPayloadAccessor,
    handlerMethodName,
    respondUtil,
  ) {
    await this[handlerMethodName](
      client,
      interactionPayload,
      interactionPayloadAccessor,
      respondUtil,
    );
  };

  handler.cancel = async (
    client,
    payload,
    interactionPayloadAccessor,
    respondUtil,
  ) => {
    await respondUtil.deleteOriginal();
  };

  handler.createPage = async function (
    client,
    payload,
    interactionPayloadAccessor,
    respondUtil,
  ) {
    let result = [];
    const channelId = payload.channel.id; // this must exist since the type is always block_actions
    const user = await User.findUserBySlackMemberId(payload.user.id);

    // validate form
    const { path, oldest, newest } = await this.keepValidateForm(
      client,
      payload,
      interactionPayloadAccessor,
    );
    // get messages
    result = await this.keepGetMessages(client, channelId, newest, oldest);
    // clean messages
    const cleanedContents = await this.keepCleanMessages(result.messages);

    const contentsBody = cleanedContents.join('');
    // create and send url message
    await this.keepCreatePageAndSendPreview(
      client,
      interactionPayloadAccessor,
      path,
      user,
      contentsBody,
      respondUtil,
    );
  };

  handler.keepValidateForm = async (
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

  handler.keepGetMessages = async (client, channelId, newest, oldest) => {
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
                  'https://user-images.githubusercontent.com/1638767/135658794-a8d2dbc8-580f-4203-b368-e74e2f3c7b3a.png',
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
        'No message found from keep command. Try different datetime.',
      );
    }
    return result;
  };

  /**
   * Get all growi users from messages
   * @param {*} messages (array of messages)
   * @returns users object with matching Slack Member ID
   */
  handler.getGrowiUsersFromMessages = async (messages) => {
    const users = messages.map((message) => {
      return message.user;
    });
    const growiUsers = await User.findUsersBySlackMemberIds(users);
    return growiUsers;
  };
  /**
   * Convert slack member ID to growi user if slack member ID is found in messages
   * @param {*} messages
   */
  handler.injectGrowiUsernameToMessages = async function (messages) {
    const growiUsers = await this.getGrowiUsersFromMessages(messages);

    messages.map(async (message) => {
      const growiUser = growiUsers.find(
        (user) => user.slackMemberId === message.user,
      );
      if (growiUser != null) {
        message.user = `${growiUser.name} (@${growiUser.username})`;
      } else {
        message.user = `This slack member ID is not registered (${message.user})`;
      }
    });
  };

  handler.keepCleanMessages = async function (messages) {
    const cleanedContents = [];
    let lastMessage = {};
    const grwTzoffset = crowi.appService.getTzoffset() * 60;
    await this.injectGrowiUsernameToMessages(messages);
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
          const time = format(new Date(ts), 'h:mm a');
          cleanedContents.push(`${message.user}  ${time}\n${message.text}\n`);
          lastMessage = message;
        }
      });
    return cleanedContents;
  };

  handler.keepCreatePageAndSendPreview = async (
    client,
    interactionPayloadAccessor,
    path,
    user,
    contentsBody,
    respondUtil,
  ) => {
    await createPageService.createPageInGrowi(
      interactionPayloadAccessor,
      path,
      contentsBody,
      respondUtil,
      user,
    );

    // TODO: contentsBody text characters must be less than 3001
    // send preview to dm
    // await client.chat.postMessage({
    //   channel: userChannelId,
    //   text: 'Preview from keep command',
    //   blocks: [
    //     markdownSectionBlock('*Preview*'),
    //     divider(),
    //     markdownSectionBlock(contentsBody),
    //     divider(),
    //   ],
    // });

    // dismiss
    await respondUtil.deleteOriginal();
  };

  handler.keepMessageBlocks = (channelName) => {
    const tzDateSec = new Date().getTime();
    const grwTzoffset = crowi.appService.getTzoffset() * 60 * 1000;

    const now = tzDateSec - grwTzoffset;
    const oldest = now - 60 * 60 * 1000;
    const newest = now;

    const initialOldest = format(oldest, 'yyyy/MM/dd-HH:mm');
    const initialNewest = format(newest, 'yyyy/MM/dd-HH:mm');
    const initialPagePath = `/slack/keep/${channelName}/${format(oldest, 'yyyyMMdd-HH:mm')} - ${format(newest, 'yyyyMMdd-HH:mm')}`;

    return [
      markdownSectionBlock('*The keep command is in alpha.*'),
      markdownSectionBlock(
        'Select the oldest and newest datetime of the messages to use.',
      ),
      inputBlock(
        {
          type: 'plain_text_input',
          action_id: 'oldest',
          initial_value: initialOldest,
        },
        'oldest',
        'Oldest datetime',
      ),
      inputBlock(
        {
          type: 'plain_text_input',
          action_id: 'newest',
          initial_value: initialNewest,
        },
        'newest',
        'Newest datetime',
      ),
      inputBlock(
        {
          type: 'plain_text_input',
          placeholder: {
            type: 'plain_text',
            text: 'Input page path to create.',
          },
          initial_value: initialPagePath,
          action_id: 'page_path',
        },
        'page_path',
        'Page path',
      ),
      actionsBlock(
        buttonElement({ text: 'Cancel', actionId: 'keep:cancel' }),
        buttonElement({
          text: 'Create page',
          actionId: 'keep:createPage',
          style: 'primary',
        }),
      ),
    ];
  };

  return handler;
};
