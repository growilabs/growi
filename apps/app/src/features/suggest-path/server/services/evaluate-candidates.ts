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
} from '../../interfaces/suggest-path-types';

const SYSTEM_PROMPT = [
  'You are a page save location evaluator for a wiki system. ',
  'Given content to be saved, its analysis (keywords and information type), and a list of search candidate pages, ',
  'propose optimal directory paths for saving the content.\n\n',
  '## How to Read Wiki Paths\n',
  'Treat the wiki path hierarchy as a content classification taxonomy. ',
  'Each path segment represents a category or topic at a certain level of abstraction.\n',
  'Example: `/engineering/frontend/react-testing-patterns`\n',
  '- `engineering` = broad domain\n',
  '- `frontend` = topic category within that domain\n',
  '- `react-testing-patterns` = specific article\n\n',
  'When proposing a save location, determine which level of the taxonomy the content belongs to ',
  'and what category name best describes it. The proposed path should reflect where the content ',
  'naturally fits in the existing classification structure.\n\n',
  '## Path Proposal\n',
  'For each suitable candidate, propose a directory path for the content. The proposed path may be:\n',
  '- An existing directory in the candidate path hierarchy\n',
  '- A new directory at the appropriate level of the taxonomy\n\n',
  'Examples given candidate `/engineering/frontend/react-testing-patterns`:\n',
  '- Content about React components → `/engineering/frontend/` (same topic category)\n',
  '- Content about CSS architecture → `/engineering/frontend/css-architecture/` (sub-topic)\n',
  '- Content about Express API design → `/engineering/backend/` (different topic at the same category level)\n\n',
  'Only propose candidates that are genuinely suitable. Skip candidates where the content has no meaningful relationship.\n\n',
  '## Flow/Stock Information Type\n',
  instructionsForInformationTypes,
  '\n\n',
  'Use flow/stock alignment between the content and candidate locations as a RANKING FACTOR, not a hard filter.\n\n',
  '## Output Format\n',
  'Return a JSON array of suggestion objects, ranked by content-destination fit (best first).\n',
  'Each object must have:\n',
  '- "path": Directory path with trailing slash (e.g., "/engineering/backend/")\n',
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      `Failed to parse LLM response as JSON: ${content.slice(0, 200)}`,
    );
  }

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
