import { Mastra } from '@mastra/core/mastra';

import { fileSearchWorkflow } from './workflows/file-search-workflow';

export const mastra = new Mastra({
  workflows: {
    fileSearchWorkflow,
  },
});
