import { Mastra } from '@mastra/core/mastra';

import { growiAgent } from './agents/growi-agent';
import { fileSearchWorkflow } from './workflows/file-search-workflow';
// eslint-disable-next-line import/no-cycle
import { growiAgentWorkflow } from './workflows/growi-agent-workflow';


export const mastra = new Mastra({
  agents: { growiAgent },
  workflows: {
    fileSearchWorkflow,
    growiAgentWorkflow,
  },
});
