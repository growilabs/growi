import { Mastra } from '@mastra/core/mastra';

import { growiAgent } from './agents/growi-agent';
import { fileSearchWorkflow } from './workflows/file-search-workflow';

export const mastra = new Mastra({
  workflows: {
    fileSearchWorkflow,
  },
  agents: {
    growiAgent,
  },
});
