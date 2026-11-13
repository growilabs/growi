// Confirms the wire shape of a signed `CommandAnswerRequest` and of the
// proxy's `CommandAnswerResult` (Requirement 10.1). See parse-command.ts's
// header comment for why every parse* function re-checks shape even though the
// body already passed signature verification.

import type {
  AgentAnswer,
  AgentFailureReason,
  AnswerSource,
  CommandAnswerRequest,
  CommandAnswerResult,
} from '../contract/command-answer.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import {
  parseConversationFailure,
  parseConversationRange,
} from './conversation-fields.js';
import { arr, isRecord, oneOf, str } from './shape.js';

const RELATION_ID_MAX = 128;
const REQUEST_ID_MAX = 128;
// Limits from design.md's CommandAnswerContract: GROWI cuts a longer answer
// down before sending, so the parser can refuse anything above them.
const MARKDOWN_MAX = 30_000;
const SOURCES_MAX = 20;
// Not in design.md; same bounds as the other title and page URL fields
// (`TITLE_MAX`/`PAGE_URL_MAX` in parse-command.ts).
const SOURCE_TITLE_MAX = 500;
const URL_MAX = 2000;

const FAILURE_REASONS: ReadonlyArray<AgentFailureReason> = [
  'timeout',
  'agent-error',
  'path-conflict',
  'forbidden',
  'conversation-unavailable',
];
const RESULT_STATUSES = [
  'delivered',
  'undeliverable',
  'unknown-request',
  'in-progress',
] as const;

type ParseError = { readonly error: 'malformed' };

const parseSource = (v: unknown): AnswerSource | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const title = str(v.title, SOURCE_TITLE_MAX);
  const url = str(v.url, URL_MAX);

  return title === undefined || url === undefined ? undefined : { title, url };
};

const parseAnswer = (v: unknown): AgentAnswer | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  switch (v.kind) {
    case 'text': {
      const markdown = str(v.markdown, MARKDOWN_MAX);
      const sources = arr(v.sources, SOURCES_MAX, parseSource);
      return markdown === undefined || sources === undefined
        ? undefined
        : { kind: 'text', markdown, sources };
    }
    case 'page-created': {
      const pageUrl = str(v.pageUrl, URL_MAX);
      const range = parseConversationRange(v.range);
      const { truncated } = v;
      return pageUrl === undefined ||
        range === undefined ||
        typeof truncated !== 'boolean'
        ? undefined
        : { kind: 'page-created', pageUrl, range, truncated };
    }
    case 'failed': {
      const reason = oneOf(v.reason, FAILURE_REASONS);
      if (reason === undefined) {
        return undefined;
      }
      if (v.conversationFailure === undefined) {
        return { kind: 'failed', reason };
      }
      const conversationFailure = parseConversationFailure(
        v.conversationFailure,
      );
      return conversationFailure === undefined
        ? undefined
        : { kind: 'failed', reason, conversationFailure };
    }
    default:
      return undefined;
  }
};

export const parseCommandAnswerRequest = (
  raw: unknown,
): CommandAnswerRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  const op = oneOf(raw.op, [OP_NAMES.commandAnswer]);
  const requestId = str(raw.requestId, REQUEST_ID_MAX);
  const answer = parseAnswer(raw.answer);

  if (
    relationId === undefined ||
    op === undefined ||
    requestId === undefined ||
    answer === undefined
  ) {
    return { error: 'malformed' };
  }

  return { relationId, op, requestId, answer };
};

export const parseCommandAnswerResult = (
  raw: unknown,
): CommandAnswerResult | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const status = oneOf(raw.status, RESULT_STATUSES);

  return status === undefined ? { error: 'malformed' } : { status };
};
