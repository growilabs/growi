import type { OpenaiServiceType } from '~/features/openai/interfaces/ai';
import {
  getClient,
  isStreamResponse,
} from '~/features/openai/server/services/client-delegator';
import { configManager } from '~/server/service/config-manager';

/**
 * Shared utility for making LLM calls that return JSON responses.
 * Handles OpenAI client initialization, JSON parsing, and response validation.
 * Consumed by `analyzeContent` (1st AI call) and `evaluateCandidates` (2nd AI call).
 */
export const callLlmForJson = async <T>(
  systemPrompt: string,
  userMessage: string,
  validate: (parsed: unknown) => parsed is T,
  validationErrorMessage: string,
): Promise<T> => {
  const openaiServiceType = configManager.getConfig(
    'openai:serviceType',
  ) as OpenaiServiceType;
  const client = getClient({ openaiServiceType });

  const completion = await client.chatCompletion({
    model: 'gpt-4.1-nano',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
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
    throw new Error('No content returned from chatCompletion');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Failed to parse LLM response as JSON: ${content.slice(0, 200)}`,
    );
  }

  if (!validate(parsed)) {
    throw new Error(validationErrorMessage);
  }

  return parsed;
};
