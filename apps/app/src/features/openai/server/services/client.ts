import OpenAI from 'openai';

import { configManager } from '~/server/service/config-manager/index.js';

export const openaiClient = new OpenAI({
  apiKey: configManager.getConfig('openai:apiKey'), // This is the default and can be omitted
});
