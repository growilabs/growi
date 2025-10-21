import type { RespondBodyForResponseUrl } from '@growi/slack';
import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import ExtensibleCustomError from 'extensible-custom-error';

export const generateDefaultRespondBodyForInternalServerError = (
  message: string,
): RespondBodyForResponseUrl => {
  return {
    text: message,
    blocks: [markdownSectionBlock(`*An error occured*\n ${message}`)],
  };
};

type Opts = {
  responseUrl?: string;
  respondBody?: RespondBodyForResponseUrl;
};

/**
 * Error class for slackbot service
 */
export class SlackCommandHandlerError extends ExtensibleCustomError {
  responseUrl?: string;

  respondBody: RespondBodyForResponseUrl;

  constructor(message: string, opts: Opts = {}) {
    super(message);
    this.responseUrl = opts.responseUrl;
    this.respondBody =
      opts.respondBody ||
      generateDefaultRespondBodyForInternalServerError(message);
  }
}
