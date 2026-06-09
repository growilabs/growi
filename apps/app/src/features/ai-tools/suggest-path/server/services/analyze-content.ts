import type { Lang } from '@growi/core/dist/interfaces';

import { instructionsForInformationTypes } from '~/features/openai/server/services/assistant/instructions/commons';

import type {
  ContentAnalysis,
  InformationType,
} from '../../interfaces/suggest-path-types';
import { callLlmForJson } from './call-llm-for-json';

const VALID_INFORMATION_TYPES: readonly InformationType[] = ['flow', 'stock'];

/**
 * Map a GROWI user-language code to its natural-language name, used to steer
 * keyword extraction toward the language of the target wiki. Keywords are
 * matched against wiki page titles in Elasticsearch, so emitting them in the
 * wiki's own language (the user's configured language) raises retrieval recall
 * for same-language pages — without it the LLM tends to follow the input
 * body's language and can miss the correct page (see #184974).
 */
const LANG_TO_NAME: Record<Lang, string> = {
  en_US: 'English',
  ja_JP: 'Japanese',
  zh_CN: 'Chinese',
  fr_FR: 'French',
  ko_KR: 'Korean',
};

const buildKeywordLanguageInstruction = (lang?: Lang): string => {
  const langName = lang != null ? LANG_TO_NAME[lang] : undefined;
  if (langName == null || langName === 'English') {
    return '';
  }
  return (
    `The wiki this content will be saved to uses ${langName}. ` +
    `Emit keywords that express the subject in BOTH English and ${langName}, ` +
    'so they match page titles written in either language. ' +
    'Keep the total within the 1 to 5 keyword limit, mixing the two languages.\n'
  );
};

const buildSystemPrompt = (lang?: Lang): string =>
  [
    'You are a content analysis assistant. Analyze the following content and return a JSON object with two fields:\n',
    '1. "keywords": An array of 1 to 5 search keywords extracted from the content. ',
    'Prioritize words that express the subject and purpose of the content — what it is fundamentally about — ',
    'over terms that merely name the specific means of implementation (such as libraries, tools, APIs, protocols, or product names) used to realize it. ',
    'Choose such an implementation-specific term as a keyword only when that term is itself the subject of the content.\n',
    buildKeywordLanguageInstruction(lang),
    '2. "informationType": Classify the content as either "flow" or "stock".\n\n',
    '## Classification Reference\n',
    instructionsForInformationTypes,
    '\n\n',
    'Return only the JSON object, no other text.\n',
    'Example: {"keywords": ["keyword1", "keyword2", "keyword3"], "informationType": "stock"}',
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

export const analyzeContent = (
  body: string,
  lang?: Lang,
): Promise<ContentAnalysis> => {
  return callLlmForJson(
    buildSystemPrompt(lang),
    body,
    isValidContentAnalysis,
    'Invalid content analysis response: expected { keywords: string[], informationType: "flow" | "stock" }',
  );
};
