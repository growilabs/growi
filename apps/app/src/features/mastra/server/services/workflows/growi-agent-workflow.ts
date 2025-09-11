import {
  createWorkflow,
} from '@mastra/core/workflows';
import { z } from 'zod';

import { generatePreMessageStep } from '../steps/generate-pre-message-step';
// eslint-disable-next-line import/no-cycle
import { growiAgentStep } from '../steps/growi-agent-step';


export const growiAgentWorkflow = createWorkflow({
  id: 'growi-agent-workflow',
  inputSchema: z.object({
    prompt: z.string().describe('Prompt for the GROWI agent'),
  }),
  outputSchema: z.object({
    value: z.string().describe('Response from the GROWI agent'),
  }),
})
  .parallel([generatePreMessageStep, growiAgentStep])
  .commit();
