import type { OpenaiServiceType } from '~/features/openai/interfaces/ai';
import { instructionsForInformationTypes } from '~/features/openai/server/services/assistant/instructions/commons';
import {
  getClient,
  isStreamResponse,
} from '~/features/openai/server/services/client-delegator';
import { configManager } from '~/server/service/config-manager';

import type {
  ContentAnalysis,
  EvaluatedSuggestion,
  SearchCandidate,
} from './suggest-path-types';

const SYSTEM_PROMPT = [
  'You are a page save location evaluator for a wiki system. ',
  'Given content to be saved, its analysis (keywords and information type), and a list of search candidate pages, ',
  "evaluate each candidate's suitability as a save location and propose optimal directory paths.\n\n",
  '## Path Proposal Patterns\n',
  'For each suitable candidate, propose a save location using ONE of three structural patterns:\n',
  '(a) **Parent directory**: The parent directory of the matching page (e.g., candidate `/tech/React/hooks` → propose `/tech/React/`)\n',
  '(b) **Subdirectory**: A subdirectory under the matching page (e.g., candidate `/tech/React/hooks` → propose `/tech/React/hooks/advanced/`)\n',
  '(c) **Sibling directory**: A new directory alongside the matching page at the SAME hierarchy level ',
  '(e.g., candidate `/tech/React/hooks` → propose `/tech/React/performance/`). ',
  'The generated path MUST be at the same depth as the candidate page.\n\n',
  '## Flow/Stock Information Type\n',
  instructionsForInformationTypes,
  '\n\n',
  'Use flow/stock alignment between the content and candidate locations as a RANKING FACTOR, not a hard filter.\n\n',
  '## Output Format\n',
  'Return a JSON array of suggestion objects, ranked by content-destination fit (best first).\n',
  'Each object must have:\n',
  '- "path": Directory path with trailing slash (e.g., "/tech/React/")\n',
  '- "label": Short display label for the suggestion\n',
  '- "description": Explanation of why this location is suitable, considering content relevance and flow/stock alignment\n\n',
  'Return an empty array `[]` if no candidates are suitable.\n',
  'Return only the JSON array, no other text.',
].join('');

function buildUserMessage(
  body: string,
  analysis: ContentAnalysis,
  candidates: SearchCandidate[],
): string {
  const candidateList = candidates
    .map(
      (c, i) =>
        `${i + 1}. Path: ${c.pagePath}\n   Snippet: ${c.snippet}\n   Score: ${c.score}`,
    )
    .join('\n');

  return [
    '## Content to Save\n',
    body,
    '\n\n## Content Analysis\n',
    `Keywords: ${analysis.keywords.join(', ')}\n`,
    `Information Type: ${analysis.informationType}\n`,
    '\n## Search Candidates\n',
    candidateList,
  ].join('');
}

const isValidEvaluatedSuggestion = (
  item: unknown,
): item is EvaluatedSuggestion => {
  if (item == null || typeof item !== 'object') {
    return false;
  }

  const obj = item as Record<string, unknown>;

  if (typeof obj.path !== 'string' || !obj.path.endsWith('/')) {
    return false;
  }

  if (typeof obj.label !== 'string' || obj.label.length === 0) {
    return false;
  }

  if (typeof obj.description !== 'string' || obj.description.length === 0) {
    return false;
  }

  return true;
};

export const evaluateCandidates = async (
  body: string,
  analysis: ContentAnalysis,
  candidates: SearchCandidate[],
): Promise<EvaluatedSuggestion[]> => {
  const openaiServiceType = configManager.getConfig(
    'openai:serviceType',
  ) as OpenaiServiceType;
  const client = getClient({ openaiServiceType });

  const userMessage = buildUserMessage(body, analysis, candidates);

  const completion = await client.chatCompletion({
    model: 'gpt-4.1-nano',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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

  const parsed: unknown = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error(
      'Invalid candidate evaluation response: expected JSON array',
    );
  }

  for (const item of parsed) {
    if (!isValidEvaluatedSuggestion(item)) {
      throw new Error(
        'Invalid suggestion in evaluation response: each item must have path (ending with /), label, and description',
      );
    }
  }

  return parsed as EvaluatedSuggestion[];
};
