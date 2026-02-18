import type { OpenaiServiceType } from '~/features/openai/interfaces/ai';
import {
  getClient,
  isStreamResponse,
} from '~/features/openai/server/services/client-delegator';
import { configManager } from '~/server/service/config-manager';

const SYSTEM_PROMPT = [
  'Extract 3 to 5 search keywords from the following content.',
  'Prioritize proper nouns and technical terms.',
  'Avoid generic or common words.',
  'Return the result as a JSON array of strings.',
  'Example: ["React", "useState", "hooks"]',
  'Return only the JSON array, no other text.',
].join('');

export const extractKeywords = async (body: string): Promise<string[]> => {
  const openaiServiceType = configManager.getConfig(
    'openai:serviceType',
  ) as OpenaiServiceType;
  const client = getClient({ openaiServiceType });

  const completion = await client.chatCompletion({
    model: 'gpt-4.1-nano',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: body },
    ],
  });

  if (isStreamResponse(completion)) {
    throw new Error('Unexpected streaming response from chatCompletion');
  }

  const choice = completion.choices[0];
  if (choice == null) {
    throw new Error('No choices returned from chatCompletion');
  }

  const content = choice.message.content;
  if (content == null) {
    return [];
  }

  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from keyword extraction');
  }

  return parsed as string[];
};
