/*
 * !!help command and its message text must exist only in growi app package!!
 * the help message should vary depending on the growi version
 */

import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';

import { growiInfoService } from '../growi-info';

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const BaseSlackCommandHandler = require('./slack-command-handler');
  const handler = new BaseSlackCommandHandler();

  handler.handleCommand = async (growiCommand, client, body, respondUtil) => {
    const appTitle = crowi.appService.getAppTitle();
    const appSiteUrl = growiInfoService.getSiteUrl();
    // adjust spacing
    let message = `*Help* (*${appTitle}* at ${appSiteUrl})\n\n`;
    message += 'Usage:     `/growi [command] [args]`\n\n';
    message += 'Commands:\n\n';
    message +=
      '`/growi note`                          Take a note on GROWI\n\n';
    message += '`/growi search [keyword]`       Search pages\n\n';
    message +=
      '`/growi keep`                          Create new page with existing slack conversations (Alpha)\n\n';

    await respondUtil.respond({
      text: 'Help',
      blocks: [markdownSectionBlock(message)],
    });
  };

  return handler;
};
