/**
 * slack
 */

module.exports = function(crowi) {
  'use strict';

  const SLACK_URL = 'https://slack.com';

  const debug = require('@alias/debug')('growi:util:slack'),
    config = crowi.getConfig(),
    Config = crowi.model('Config'),
    Slack = require('slack-node'),
    slack = {};

  const postWithIwh = function(messageObj, callback) {
    const client = new Slack();
    client.setWebhook(config.notification['slack:incomingWebhookUrl']);
    client.webhook(messageObj, callback);
  }

  const postWithWebApi = function(messageObj, callback) {
    const client = new Slack(config.notification['slack:token']);
    // stringify attachments
    if (messageObj.attachments != null) {
      messageObj.attachments = JSON.stringify(messageObj.attachments);
    }
    client.api('chat.postMessage', messageObj, callback);
  }

  const convertMarkdownToMrkdwn = function(body) {
    var url = '';
    if (config.crowi && config.crowi['app:url']) {
      url = config.crowi['app:url'];
    }

    body = body
      .replace(/\n\*\s(.+)/g, '\n• $1')
      .replace(/#{1,}\s?(.+)/g, '\n*$1*')
      .replace(/(\[(.+)\]\((https?:\/\/.+)\))/g, '<$3|$2>')
      .replace(/(\[(.+)\]\((\/.+)\))/g, '<' + url + '$3|$2>')
      ;

    return body;
  };

  const prepareAttachmentTextForCreate = function(page, user) {
    var body = page.revision.body;
    if (body.length > 2000) {
      body = body.substr(0, 2000) + '...';
    }

    return convertMarkdownToMrkdwn(body);
  };

  const prepareAttachmentTextForUpdate = function(page, user, previousRevision) {
    var diff = require('diff');
    var diffText = ''

    diff.diffLines(previousRevision.body, page.revision.body).forEach(function(line) {
      debug('diff line', line)
      var value = line.value.replace(/\r\n|\r/g, '\n');
      if (line.added) {
        diffText += `:pencil2: ...\n${line.value}`;
      } else if (line.removed) {
        // diffText += '-' + line.value.replace(/(.+)?\n/g, '- $1\n');
        // 1以下は無視
        if (line.count > 1) {
          diffText += `:wastebasket: ... ${line.count} lines\n`;
        }
      } else {
        //diffText += '...\n';
      }
    });

    debug('diff is', diffText)

    return diffText;
  };

  const prepareSlackMessage = function(page, user, channel, updateType, previousRevision) {
    var url = config.crowi['app:url'] || '';
    var body = page.revision.body;

    if (updateType == 'create') {
      body = prepareAttachmentTextForCreate(page, user);
    } else {
      body = prepareAttachmentTextForUpdate(page, user, previousRevision);
    }

    var attachment = {
      color: '#263a3c',
      author_name: '@' + user.username,
      author_link: url + '/user/' + user.username,
      author_icon: user.image,
      title: page.path,
      title_link: url + '/' + page._id,
      text: body,
      mrkdwn_in: ["text"],
    };
    if (user.image) {
      attachment.author_icon = user.image;
    }

    var message = {
      channel: '#' + channel,
      username: Config.appTitle(config),
      text: getSlackMessageText(page.path, user, updateType),
      attachments: [attachment],
    };

    return message;
  };

  const getSlackMessageText = function(path, user, updateType) {
    let text;
    const url = config.crowi['app:url'] || '';

    const pageUrl = `<${url}${path}|${path}>`;
    if (updateType == 'create') {
      text = `:white_check_mark: ${user.username} created a new page! ${pageUrl}`;
    } else {
      text = `:up: ${user.username} updated ${pageUrl}`;
    }

    return text;
  };

  // slack.post = function (channel, message, opts) {
  slack.post = (page, user, channel, updateType, previousRevision) => {
    const messageObj = prepareSlackMessage(page, user, channel, updateType, previousRevision);

    return new Promise((resolve, reject) => {
      // define callback function for Promise
      const callback = function(err, res) {
        if (err) {
          debug('Post error', err, res);
          debug('Sent data to slack is:', messageObj);
          return reject(err);
        }
        resolve(res);
      };

      // when incoming Webhooks is prioritized
      if (Config.isIncomingWebhookPrioritized(config)) {
        if (Config.hasSlackIwhUrl(config)) {
          debug(`posting message with IncomingWebhook`);
          postWithIwh(messageObj, callback);
        }
        else if (Config.hasSlackToken(config)) {
          debug(`posting message with Web API`);
          postWithWebApi(messageObj, callback);
        }
      }
      // else
      else {
        if (Config.hasSlackToken(config)) {
          debug(`posting message with Web API`);
          postWithWebApi(messageObj, callback);
        }
        else if (Config.hasSlackIwhUrl(config)) {
          debug(`posting message with IncomingWebhook`);
          postWithIwh(messageObj, callback);
        }
      }

      resolve();
    });
  };

  return slack;
};
