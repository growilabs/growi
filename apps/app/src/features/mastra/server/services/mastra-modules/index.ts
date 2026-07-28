import { Mastra } from '@mastra/core/mastra';

import { growiAgent } from './agents/growi-agent';
import { suggestPathAgent } from './agents/suggest-path';

export const mastra = new Mastra({
  agents: {
    growiAgent,
    suggestPathAgent,
  },
});
