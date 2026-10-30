import type { IPageHasId, IRevisionHasId, ITag, Origin } from '@growi/core';

import type { IOptionsForCreate, IOptionsForUpdate } from '../page';

/**
 * A Gen 2 notification destination as submitted from the page-save form.
 * Deliberately NOT imported from the chat-integration feature (which owns
 * `Gen2Destination`) -- this shared `interfaces/` module must not depend on
 * a feature's server-side module. Shape is kept identical by convention.
 */
export type IApiv3ChatIntegrationDestinationInput = {
  /**
   * Which relation (paired Gen 2 workspace) this destination's channel
   * belongs to. Required so `NotificationOutbox.enqueue` (task 8.1) can
   * route the save-time-selected destination to the right relation's
   * outbox row -- without it, a channel picked from the save-time UI could
   * not be told apart from the same channel id in a different workspace.
   */
  relationId: string;
  platform: string;
  channelId: string;
};

export type IApiv3PageCreateParams = IOptionsForCreate & {
  path?: string;
  parentPath?: string;
  optionalParentPath?: string;

  body?: string;
  pageTags?: string[];

  origin?: Origin;

  isSlackEnabled?: boolean;
  slackChannels?: string;
  /** Gen 2's save-time destinations (Requirement 2.2). Separate from Gen 1's fields above. */
  chatIntegrationDestinations?: IApiv3ChatIntegrationDestinationInput[];
};

export type IApiv3PageCreateResponse = {
  page: IPageHasId;
  tags: ITag[];
  revision: IRevisionHasId;
};

export type IApiv3PageUpdateParams = IOptionsForUpdate & {
  pageId: string;
  revisionId?: string;
  body: string;

  origin?: Origin;
  isSlackEnabled?: boolean;
  slackChannels?: string;
  /** Gen 2's save-time destinations (Requirement 2.2). Separate from Gen 1's fields above. */
  chatIntegrationDestinations?: IApiv3ChatIntegrationDestinationInput[];
  wip?: boolean;
};

export type IApiv3PageUpdateResponse = {
  page: IPageHasId;
  revision: IRevisionHasId;
};

export const PageUpdateErrorCode = {
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
} as const;
