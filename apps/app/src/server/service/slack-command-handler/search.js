import {
  divider,
  markdownSectionBlock,
} from '@growi/slack/dist/utils/block-kit-builder';
import { generateLastUpdateMrkdwn } from '@growi/slack/dist/utils/generate-last-update-markdown';

import loggerFactory from '~/utils/logger';

import { growiInfoService } from '../growi-info';

const logger = loggerFactory('growi:service:SlackCommandHandler:search');

const PAGINGLIMIT = 7;

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const BaseSlackCommandHandler = require('./slack-command-handler');
  const handler = new BaseSlackCommandHandler(crowi);

  function getKeywords(growiCommandArgs) {
    const keywords = growiCommandArgs.join(' ');
    return keywords;
  }

  function appendSpeechBaloon(mrkdwn, commentCount) {
    return commentCount != null && commentCount > 0
      ? `${mrkdwn}   :speech_balloon: ${commentCount}`
      : mrkdwn;
  }

  function generateSearchResultPageLinkMrkdwn(appUrl, growiCommandArgs) {
    const url = new URL('/_search', appUrl);
    url.searchParams.append(
      'q',
      growiCommandArgs.map((kwd) => encodeURIComponent(kwd)).join('+'),
    );
    return `<${url.href} | Results page>`;
  }

  function generatePageLinkMrkdwn(pathname, href) {
    return `<${decodeURI(href)} | ${decodeURI(pathname)}>`;
  }

  async function retrieveSearchResults(growiCommandArgs, offset = 0) {
    const keywords = getKeywords(growiCommandArgs);

    const { searchService } = crowi;
    const options = { limit: PAGINGLIMIT, offset };
    const [results] = await searchService.searchKeyword(
      keywords,
      null,
      {},
      options,
    );
    const resultsTotal = results.meta.total;

    const pages = results.data.map((data) => {
      const {
        path,
        updated_at: updatedAt,
        comment_count: commentCount,
      } = data._source;
      return { path, updatedAt, commentCount };
    });

    return {
      pages,
      offset,
      resultsTotal,
    };
  }

  function buildRespondBodyForSearchResult(searchResult, growiCommandArgs) {
    const appUrl = growiInfoService.getSiteUrl();
    const appTitle = crowi.appService.getAppTitle();

    const { pages, offset, resultsTotal } = searchResult;

    const keywords = getKeywords(growiCommandArgs);

    let searchResultsDesc;
    switch (resultsTotal) {
      case 1:
        searchResultsDesc = `*${resultsTotal}* page is found.`;
        break;
      default:
        searchResultsDesc = `*${resultsTotal}* pages are found.`;
        break;
    }

    const contextBlock = {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            `keyword(s) : *"${keywords}"*` +
            `  |  Total ${resultsTotal} pages` +
            `  |  Current: ${offset + 1} - ${offset + pages.length}` +
            `  |  ${generateSearchResultPageLinkMrkdwn(appUrl, growiCommandArgs)}`,
        },
      ],
    };

    const now = new Date();
    const blocks = [
      markdownSectionBlock(
        `:mag: <${decodeURI(appUrl)}|*${appTitle}*>\n${searchResultsDesc}`,
      ),
      contextBlock,
      { type: 'divider' },
      // create an array by map and extract
      ...pages.map((page) => {
        const { path, updatedAt, commentCount } = page;
        // generate URL
        const url = new URL(path, appUrl);
        const { href, pathname } = url;

        return {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `${appendSpeechBaloon(`*${generatePageLinkMrkdwn(pathname, href)}*`, commentCount)}` +
              `  \`${generateLastUpdateMrkdwn(updatedAt, now)}\``,
          },
          accessory: {
            type: 'button',
            action_id: 'search:shareSinglePageResult',
            text: {
              type: 'plain_text',
              text: 'Share',
            },
            value: JSON.stringify({ page, href, pathname }),
          },
        };
      }),
      { type: 'divider' },
      contextBlock,
    ];

    const actionBlocks = {
      type: 'actions',
      elements: [],
    };
    // add "Dismiss" button
    actionBlocks.elements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: 'Dismiss',
      },
      style: 'danger',
      action_id: 'search:dismissSearchResults',
    });
    // show "Prev" button if previous page exists
    // eslint-disable-next-line yoda
    if (0 < offset) {
      actionBlocks.elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: '< Prev',
        },
        action_id: 'search:showPrevResults',
        value: JSON.stringify({ offset, growiCommandArgs }),
      });
    }
    // show "Next" button if next page exists
    if (offset + PAGINGLIMIT < resultsTotal) {
      actionBlocks.elements.push({
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Next >',
        },
        action_id: 'search:showNextResults',
        value: JSON.stringify({ offset, growiCommandArgs }),
      });
    }
    blocks.push(actionBlocks);

    return {
      text: 'Successed To Search',
      blocks,
    };
  }

  async function buildRespondBody(growiCommandArgs) {
    const firstKeyword = growiCommandArgs[0];

    // enpty keyword
    if (firstKeyword == null) {
      return {
        text: 'Input keywords',
        blocks: [
          markdownSectionBlock(
            '*Input keywords.*\n Hint\n `/growi search [keyword]`',
          ),
        ],
      };
    }

    const searchResult = await retrieveSearchResults(growiCommandArgs);

    // no search results
    if (searchResult.resultsTotal === 0) {
      const keywords = getKeywords(growiCommandArgs);
      logger.info(`No page found with "${keywords}"`);

      return {
        text: `No page found with "${keywords}"`,
        blocks: [
          markdownSectionBlock(
            `*No page matches your keyword(s) "${keywords}".*`,
          ),
          markdownSectionBlock(':mag: *Help: Searching*'),
          divider(),
          markdownSectionBlock(
            '`word1` `word2` (divide with space) \n Search pages that include both word1, word2 in the title or body',
          ),
          divider(),
          markdownSectionBlock(
            '`"This is GROWI"` (surround with double quotes) \n Search pages that include the phrase "This is GROWI"',
          ),
          divider(),
          markdownSectionBlock(
            '`-keyword` \n Exclude pages that include keyword in the title or body',
          ),
          divider(),
          markdownSectionBlock(
            '`prefix:/user/` \n Search only the pages that the title start with /user/',
          ),
          divider(),
          markdownSectionBlock(
            '`-prefix:/user/` \n Exclude the pages that the title start with /user/',
          ),
          divider(),
          markdownSectionBlock('`tag:wiki` \n Search for pages with wiki tag'),
          divider(),
          markdownSectionBlock('`-tag:wiki` \n Exclude pages with wiki tag'),
        ],
      };
    }

    return buildRespondBodyForSearchResult(searchResult, growiCommandArgs);
  }

  handler.handleCommand = async (growiCommand, client, body, respondUtil) => {
    const { growiCommandArgs } = growiCommand;

    const respondBody = await buildRespondBody(growiCommandArgs);
    await respondUtil.respond(respondBody);
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

  handler.shareSinglePageResult = async (
    client,
    payload,
    interactionPayloadAccessor,
    respondUtil,
  ) => {
    const { user } = payload;

    const appUrl = growiInfoService.getSiteUrl();
    const appTitle = crowi.appService.getAppTitle();

    const value = interactionPayloadAccessor.firstAction()?.value; // shareSinglePage action must have button action
    if (value == null) {
      await respondUtil.respond({
        text: 'Error occurred',
        blocks: [markdownSectionBlock('Failed to share the result.')],
      });
      return;
    }

    const parsedValue =
      interactionPayloadAccessor.getOriginalData() || JSON.parse(value);

    // restore page data from value
    const { page, href, pathname } = parsedValue;
    const { updatedAt, commentCount } = page;

    // share
    const now = new Date();
    return respondUtil.respondInChannel({
      blocks: [
        { type: 'divider' },
        markdownSectionBlock(
          `${appendSpeechBaloon(`*${generatePageLinkMrkdwn(pathname, href)}*`, commentCount)}`,
        ),
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text:
                `<${decodeURI(appUrl)}|*${appTitle}*>` +
                `  |  Last updated: \`${generateLastUpdateMrkdwn(updatedAt, now)}\`` +
                `  |  Shared by *${user.username}*`,
            },
          ],
        },
      ],
    });
  };

  async function showPrevOrNextResults(
    interactionPayloadAccessor,
    isNext = true,
    respondUtil,
  ) {
    const value = interactionPayloadAccessor.firstAction()?.value;
    if (value == null) {
      await respondUtil.respond({
        text: 'Error occurred',
        blocks: [markdownSectionBlock('Failed to show the next results.')],
      });
      return;
    }

    const parsedValue =
      interactionPayloadAccessor.getOriginalData() || JSON.parse(value);

    const { growiCommandArgs, offset: offsetNum } = parsedValue;
    const newOffsetNum = isNext
      ? offsetNum + PAGINGLIMIT
      : offsetNum - PAGINGLIMIT;

    const searchResult = await retrieveSearchResults(
      growiCommandArgs,
      newOffsetNum,
    );

    await respondUtil.replaceOriginal(
      buildRespondBodyForSearchResult(searchResult, growiCommandArgs),
    );
  }

  handler.showPrevResults = async (
    client,
    payload,
    interactionPayloadAccessor,
    respondUtil,
  ) => showPrevOrNextResults(interactionPayloadAccessor, false, respondUtil);

  handler.showNextResults = async (
    client,
    payload,
    interactionPayloadAccessor,
    respondUtil,
  ) => showPrevOrNextResults(interactionPayloadAccessor, true, respondUtil);

  handler.dismissSearchResults = async (
    client,
    payload,
    interactionPayloadAccessor,
    respondUtil,
  ) => respondUtil.deleteOriginal();

  return handler;
};
