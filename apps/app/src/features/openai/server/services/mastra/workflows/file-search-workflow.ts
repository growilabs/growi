import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { fileSearchStep } from '../steps/file-search-step';
import { generatePreMessageStep } from '../steps/generate-pre-message-step';

export const fileSearchWorkflow = createWorkflow({
  id: 'file-search-workflow',
  inputSchema: z.object({
    prompt: z.string().describe('Prompt entered by user'),
    instruction: z.string().describe('Instruction to the AI'),
    vectorStoreId: z.string().describe('ID of the vector store to be used for file search'),
  }),
  outputSchema: z.object({
    value: z.string().describe('FileSearch results'),
  }),
})
  .parallel([generatePreMessageStep, fileSearchStep])
  .commit();
