import { Mastra } from '@mastra/core/mastra';

import { growiAgent } from './agents/growi-agent';
import { storage } from './memory';

export const mastra = new Mastra({
  agents: {
    growiAgent,
  },
  storage,
});
