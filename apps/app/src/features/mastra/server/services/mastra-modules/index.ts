import { Mastra } from '@mastra/core/mastra';

import { growiAgent } from './agents/growi-agent';

export const mastra = new Mastra({
  agents: {
    growiAgent,
  },
});
