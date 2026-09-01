// Confirms the wire shape of a signed `CommandRequest` before it is trusted
// anywhere downstream (Requirement 10.1). Signature verification only shows
// the body wasn't altered in transit -- it says nothing about whether the
// body actually has the shape `CommandRequest` promises. This is the only
// one of task 6.2's 7 functions whose body carries its own discriminant
// (`kind`), so it is also the only one that can return `unknown-kind`
// (design.md's callout box directly above the parse* signatures) -- the
// other 6 have no `kind` field to be unknown about and return only
// `malformed`.

import { COMMAND_NAMES, type CommandName } from '../commands/command-names.js';
import type { CommandRequest, KeepMessage } from '../contract/command.js';
import { OP_NAMES } from '../endpoints/op-names.js';
import { parseChannelRef, parseChatAccountRef } from './common-fields.js';
import { arr, isRecord, oneOf, str } from './shape.js';

// Defensive upper bounds (see `common-fields.ts`'s comment for why these are
// hand-picked rather than derived from design.md, which leaves the exact
// numbers to this task). Generous enough that no legitimate request is ever
// rejected, finite so a compromised-but-still-keyholding peer can't stall
// the receiving side with an oversized body.
const RELATION_ID_MAX = 128;
const REQUEST_ID_MAX = 128;
const KEYWORD_MAX = 500;
/** A search results page; nothing in this protocol needs more than this per request. */
const SEARCH_LIMIT_MAX = 100;
/** A GROWI page path -- generous for any realistic hierarchy depth. */
const PATH_MAX = 4000;
/**
 * A page body arriving from `create-page`. An empty body is a legitimate
 * GROWI page (task 6.1's Implementation Notes), so `body` is checked by
 * hand below instead of being routed through `str` (which rejects empty
 * strings unconditionally).
 */
const BODY_MAX = 200_000;
const MESSAGES_MAX = 200;
const POSTED_AT_MAX = 64;
/**
 * A single kept chat message's markdown -- smaller than a page body. An
 * empty value is legitimate (an attachment/image-only chat message has no
 * text body), so this is checked by hand, not via `str` (see `body` below).
 */
const KEEP_MARKDOWN_MAX = 20_000;
const PAGE_URL_MAX = 2000;

type ParseError = { readonly error: 'malformed' | 'unknown-kind' };

const COMMAND_NAME_VALUES: ReadonlyArray<CommandName> =
  Object.values(COMMAND_NAMES);

const parseSearchLimit = (v: unknown): number | undefined =>
  typeof v === 'number' &&
  Number.isInteger(v) &&
  v >= 1 &&
  v <= SEARCH_LIMIT_MAX
    ? v
    : undefined;

const parseKeepMessage = (v: unknown): KeepMessage | undefined => {
  if (!isRecord(v)) {
    return undefined;
  }

  const postedAt = str(v.postedAt, POSTED_AT_MAX);
  const author = parseChatAccountRef(v.author);
  const markdown =
    typeof v.markdown === 'string' && v.markdown.length <= KEEP_MARKDOWN_MAX
      ? v.markdown
      : undefined;

  if (
    postedAt === undefined ||
    author === undefined ||
    markdown === undefined
  ) {
    return undefined;
  }

  return { postedAt, author, markdown };
};

export const parseCommandRequest = (
  raw: unknown,
): CommandRequest | ParseError => {
  if (!isRecord(raw)) {
    return { error: 'malformed' };
  }

  const relationId = str(raw.relationId, RELATION_ID_MAX);
  // This parser only ever accepts `op === 'command'`: `oneOf` with a
  // single-member allowed list both confirms `op` is a real `OP_NAMES`
  // member AND that it's the one value this specific endpoint allows.
  const op = oneOf(raw.op, [OP_NAMES.command]);
  const requestId = str(raw.requestId, REQUEST_ID_MAX);
  const actor = parseChatAccountRef(raw.actor);
  const channel = parseChannelRef(raw.channel);

  if (
    relationId === undefined ||
    op === undefined ||
    requestId === undefined ||
    actor === undefined ||
    channel === undefined
  ) {
    return { error: 'malformed' };
  }

  const kind = oneOf(raw.kind, COMMAND_NAME_VALUES);
  if (kind === undefined) {
    return { error: 'unknown-kind' };
  }

  const envelope = { relationId, op, requestId, actor, channel };

  switch (kind) {
    case COMMAND_NAMES.search: {
      const keyword = str(raw.keyword, KEYWORD_MAX);
      const limit = parseSearchLimit(raw.limit);
      if (keyword === undefined || limit === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, keyword, limit };
    }
    case COMMAND_NAMES.createPage: {
      const path = str(raw.path, PATH_MAX);
      const body =
        typeof raw.body === 'string' && raw.body.length <= BODY_MAX
          ? raw.body
          : undefined;
      if (path === undefined || body === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, path, body };
    }
    case COMMAND_NAMES.keep: {
      const path = str(raw.path, PATH_MAX);
      const messages = arr(raw.messages, MESSAGES_MAX, parseKeepMessage);
      if (path === undefined || messages === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, path, messages };
    }
    case COMMAND_NAMES.linkPreview: {
      const pageUrl = str(raw.pageUrl, PAGE_URL_MAX);
      if (pageUrl === undefined) {
        return { error: 'malformed' };
      }
      return { ...envelope, kind, pageUrl };
    }
    case COMMAND_NAMES.help: {
      return { ...envelope, kind };
    }
    default: {
      // Unreachable: COMMAND_NAME_VALUES enumerates all 5 CommandName
      // members and `kind` was already narrowed to one of them above.
      return { error: 'unknown-kind' };
    }
  }
};
