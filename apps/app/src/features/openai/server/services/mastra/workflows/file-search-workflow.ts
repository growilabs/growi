import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { fileSearchStep } from '../steps/file-search-step';
import { generatePreMessageStep } from '../steps/generate-pre-message-step';

export const fileSearchWorkflow = createWorkflow({
  id: 'file-search-workflow',
  inputSchema: z.object({
    prompt: z.string(),
    instruction: z.string(),
    vectorStoreId: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
})
  .parallel([generatePreMessageStep, fileSearchStep])
  .commit();
