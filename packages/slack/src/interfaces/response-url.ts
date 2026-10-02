import type { Block, KnownBlock } from '@slack/web-api';

export type RespondBodyForResponseUrl = {
  text?: string;
  blocks?: (KnownBlock | Block)[];
};
