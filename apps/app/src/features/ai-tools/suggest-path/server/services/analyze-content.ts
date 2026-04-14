import { instructionsForInformationTypes } from '~/features/openai/server/services/assistant/instructions/commons';

import type {
  ContentAnalysis,
  InformationType,
} from '../../interfaces/suggest-path-types';
import { callLlmForJson } from './call-llm-for-json';

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

export const analyzeContent = (body: string): Promise<ContentAnalysis> => {
  return callLlmForJson(
    SYSTEM_PROMPT,
    body,
    isValidContentAnalysis,
    'Invalid content analysis response: expected { keywords: string[], informationType: "flow" | "stock" }',
  );
};
