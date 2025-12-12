import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import { reshapeContentsBody } from '@growi/slack/dist/utils/reshape-contents-body';

import Crowi from '~/server/crowi';
import { generalXssFilter } from '~/services/general-xss-filter';
import loggerFactory from '~/utils/logger';

import { growiInfoService } from '../growi-info';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:service:CreatePageService');

const { pathUtils } = require('@growi/core/dist/utils');
const mongoose = require('mongoose');

class CreatePageService {
  /** @type {import('~/server/crowi').default} Crowi instance */
  crowi;

  /** @param {import('~/server/crowi').default} crowi Crowi instance */
  constructor(crowi) {
    this.crowi = crowi;
  }

  async createPageInGrowi(
    interactionPayloadAccessor,
    path,
    contentsBody,
    respondUtil,
    user,
  ) {
    const reshapedContentsBody = reshapeContentsBody(contentsBody);

    // sanitize path
    const sanitizedPath = generalXssFilter.process(path);
    const normalizedPath = pathUtils.normalizePath(sanitizedPath);

    // Since an ObjectId is required for creating a page, if a user does not exist, a dummy user will be generated
    const userOrDummyUser =
      user != null ? user : { _id: new mongoose.Types.ObjectId() };

    const page = await this.crowi.pageService.create(
      normalizedPath,
      reshapedContentsBody,
      userOrDummyUser,
      {},
    );

    // Send a message when page creation is complete
    const growiUri = growiInfoService.getSiteUrl();
    await respondUtil.respond({
      text: 'Page has been created',
      blocks: [
        markdownSectionBlock(
          `The page <${decodeURI(`${growiUri}/${page._id} | ${decodeURI(growiUri + normalizedPath)}`)}> has been created.`,
        ),
      ],
    });
  }
}

module.exports = CreatePageService;
