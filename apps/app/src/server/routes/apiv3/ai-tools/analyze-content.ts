import type { OpenaiServiceType } from '~/features/openai/interfaces/ai';
import { instructionsForInformationTypes } from '~/features/openai/server/services/assistant/instructions/commons';
import {
  getClient,
  isStreamResponse,
} from '~/features/openai/server/services/client-delegator';
import { configManager } from '~/server/service/config-manager';

import type { ContentAnalysis, InformationType } from './suggest-path-types';

const VALID_INFORMATION_TYPES: readonly InformationType[] = ['flow', 'stock'];

const SYSTEM_PROMPT = [
  'You are a content analysis assistant. Analyze the following content and return a JSON object with two fields:\n',
  '1. "keywords": An array of 1 to 5 search keywords extracted from the content. ',
  'Prioritize proper nouns and technical terms over generic or common words.\n',
  '2. "informationType": Classify the content as either "flow" or "stock".\n\n',
  '## Classification Reference\n',
  instructionsForInformationTypes,
  '\n\n',
  'Return only the JSON object, no other text.\n',
  'Example: {"keywords": ["React", "useState", "hooks"], "informationType": "stock"}',
].join('');

const isValidContentAnalysis = (parsed: unknown): parsed is ContentAnalysis => {
  if (parsed == null || typeof parsed !== 'object') {
    return false;
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.keywords) || obj.keywords.length === 0) {
    return false;
  }

  if (
    typeof obj.informationType !== 'string' ||
    !VALID_INFORMATION_TYPES.includes(obj.informationType as InformationType)
  ) {
    return false;
  }

  return true;
};

export const analyzeContent = async (
  body: string,
): Promise<ContentAnalysis> => {
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

  if (!isValidContentAnalysis(parsed)) {
    throw new Error(
      'Invalid content analysis response: expected { keywords: string[], informationType: "flow" | "stock" }',
    );
  }

  return parsed;
};
