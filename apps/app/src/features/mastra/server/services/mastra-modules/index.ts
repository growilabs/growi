import { Mastra } from '@mastra/core/mastra';

import { growiAgent } from './agents/growi-agent';
import { suggestPathAgent } from './agents/suggest-path';
import { summarizeAgent } from './agents/summarize';

export const mastra = new Mastra({
  agents: {
    growiAgent,
    suggestPathAgent,
    summarizeAgent,
  },
});
