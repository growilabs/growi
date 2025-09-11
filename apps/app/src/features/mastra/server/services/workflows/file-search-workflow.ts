import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { fileSearchStep } from '../steps/file-search-step';
import { generatePreMessageStep } from '../steps/generate-pre-message-step';

export const fileSearchWorkflow = createWorkflow({
  id: 'sequential-workflow',
  inputSchema: z.object({
    prompt: z.string().describe('Prompt entered by user'),
  }),
  outputSchema: z.object({
    value: z.string().describe('FileSearch results'),
  }),
})
  .parallel([generatePreMessageStep, fileSearchStep])
  .commit();
