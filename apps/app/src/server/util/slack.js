import urljoin from 'url-join';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:util:slack');

/**
 * slack
 */

/* eslint-disable no-use-before-define */

const convertMarkdownToMarkdown = (body, siteUrl) =>
  body
    .replace(/\n\*\s(.+)/g, '\n• $1')
    .replace(/#{1,}\s?(.+)/g, '\n*$1*')
    .replace(/(\[(.+)\]\((https?:\/\/.+)\))/g, '<$3|$2>')
    .replace(/(\[(.+)\]\((\/.+)\))/g, `<${siteUrl}$3|$2>`);

const prepareAttachmentTextForCreate = (page, siteUrl) => {
  let body = page.revision.body;
  if (body.length > 2000) {
    body = `${body.substr(0, 2000)}...`;
  }

  return convertMarkdownToMarkdown(body, siteUrl);
};

/**
 * Return diff with latest revisionBody
 * @param {IPageHasId} page
 * @param {string} siteUrl
 * @param {IRevisionHasId} previousRevision
 */
const prepareAttachmentTextForUpdate = (page, siteUrl, previousRevision) => {
  if (previousRevision == null) {
    return;
  }

  const diff = require('diff');
  let diffText = '';

  diff.diffLines(previousRevision.body, page.revision.body).forEach((line) => {
    logger.debug('diff line', line);
    const value = line.value.replace(/\r\n|\r/g, '\n'); // eslint-disable-line no-unused-vars
    if (line.added) {
      diffText += `${line.value} ... :lower_left_fountain_pen:`;
    } else if (line.removed) {
      // diffText += '-' + line.value.replace(/(.+)?\n/g, '- $1\n');
      // 1以下は無視
      if (line.count > 1) {
        diffText += `:wastebasket: ... ${line.count} lines\n`;
      }
    } else {
      // diffText += '...\n';
    }
  });

  logger.debug('diff is', diffText);

  return diffText;
};

const prepareAttachmentTextForComment = (comment) => {
  let body = comment.comment;
  if (body.length > 2000) {
    body = `${body.substr(0, 2000)}...`;
  }

  if (comment.isMarkdown) {
    return convertMarkdownToMarkdown(body);
  }

  return body;
};

const generateSlackMessageTextForPage = (
  path,
  pageId,
  user,
  siteUrl,
  updateType,
) => {
  let text;

  const pageUrl = `<${urljoin(siteUrl, pageId)}|${path}>`;
  if (updateType === 'create') {
    text = `:rocket: ${user.username} created a new page! ${pageUrl}`;
  } else {
    text = `:heavy_check_mark: ${user.username} updated ${pageUrl}`;
  }

  return text;
};

export const prepareSlackMessageForPage = (
  page,
  user,
  appTitle,
  siteUrl,
  channel,
  updateType,
  previousRevision,
) => {
  let body = page.revision.body;

  if (updateType === 'create') {
    body = prepareAttachmentTextForCreate(page, siteUrl);
  } else {
    body = prepareAttachmentTextForUpdate(page, siteUrl, previousRevision);
  }

  const attachment = {
    color: '#263a3c',
    author_name: `@${user.username}`,
    author_link: urljoin(siteUrl, 'user', user.username),
    author_icon: user.image,
    title: page.path,
    title_link: urljoin(siteUrl, page.id),
    text: body,
    mrkdwn_in: ['text'],
  };
  if (user.image) {
    attachment.author_icon = user.image;
  }

  const message = {
    channel: channel != null ? `#${channel}` : undefined,
    username: appTitle,
    text: generateSlackMessageTextForPage(
      page.path,
      page.id,
      user,
      siteUrl,
      updateType,
    ),
    attachments: [attachment],
  };

  return message;
};

export const prepareSlackMessageForComment = (
  comment,
  user,
  appTitle,
  siteUrl,
  channel,
  path,
) => {
  const body = prepareAttachmentTextForComment(comment);

  const attachment = {
    color: '#263a3c',
    author_name: `@${user.username}`,
    author_link: urljoin(siteUrl, 'user', user.username),
    author_icon: user.image,
    text: body,
    mrkdwn_in: ['text'],
  };
  if (user.image) {
    attachment.author_icon = user.image;
  }

  const pageUrl = `<${urljoin(siteUrl, String(comment.page))}|${path}>`;
  const text = `:speech_balloon: ${user.username} commented on ${pageUrl}`;

  const message = {
    channel: channel != null ? `#${channel}` : undefined,
    username: appTitle,
    text,
    attachments: [attachment],
  };

  return message;
};

/**
 * For GlobalNotification
 *
 * @param {string} messageBody
 * @param {string} attachmentBody
 * @param {string} slackChannel
 */
export const prepareSlackMessageForGlobalNotification = (
  messageBody,
  attachmentBody,
  appTitle,
  slackChannel,
) => {
  const attachment = {
    color: '#263a3c',
    text: attachmentBody,
    mrkdwn_in: ['text'],
  };

  const message = {
    channel: slackChannel != null ? `#${slackChannel}` : undefined,
    username: appTitle,
    text: messageBody,
    attachments: JSON.stringify([attachment]),
  };

  return message;
};
