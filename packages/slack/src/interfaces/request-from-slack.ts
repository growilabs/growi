import type { Request } from 'express';

export interface IInteractionPayloadAccessor {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  firstAction(): any;
}

export type RequestFromSlack = Request & {
  // appended by slack
  headers: {
    'x-slack-signature'?: string;
    'x-slack-request-timestamp': number;
  };

  // appended by GROWI or slackbot-proxy
  slackSigningSecret?: string;

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  interactionPayload?: any;
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  interactionPayloadAccessor?: any;
};
