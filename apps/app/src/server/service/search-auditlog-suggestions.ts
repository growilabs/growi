import type { IUser } from '@growi/core';
import mongoose from 'mongoose';

import type {
  AuditlogSuggestionField,
  AuditlogSuggestionsResponse,
} from '~/interfaces/activity';
import { UserStatus } from '~/server/models/user/conts';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type SearchService from './search';
import { sanitizeEndpointForIndex } from './search-delegator/sanitize-endpoint-for-index';

const logger = loggerFactory('growi:service:search-auditlog-suggestions');

type AuditlogSuggestionBackend = Pick<
  SearchService,
  'isReachable' | 'fullTextSearchDelegator'
>;

// Below this length a prefix matches most stored values, so the MongoDB
// fallback would group most of the collection for a near-useless list. ES has
// no such limit, so a 1-char username (e.g. `a`) stays suggestible there.
const AUDITLOG_SUGGESTION_FALLBACK_MIN_QUERY_LENGTH: {
  readonly [K in AuditlogSuggestionField]: number;
} = {
  username: 2,
  // Nearly every endpoint shares the `/_api/` prefix, so no length short of
  // `/_api/v3/` narrows the scan; the fallback's load is bounded by maxTimeMS
  // instead, and '/' answers like ES does.
  endpoint: 1,
};

// `endpoint` is stored as `req.originalUrl`, which for an ordinary
// (origin-form) request has no scheme or host and starts with '/'.
const URL_ORIGIN_PATTERN = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i;

const toEndpointSearchPath = (q: string): string => {
  // A fragment never reaches the server, so no stored endpoint contains '#'.
  const path = sanitizeEndpointForIndex(
    q.replace(URL_ORIGIN_PATTERN, '').split('#')[0],
  ).trim();
  if (path === '' || path.startsWith('/')) return path;
  return `/${path}`;
};

async function searchAuditlogFieldValues(
  backend: AuditlogSuggestionBackend,
  field: AuditlogSuggestionField,
  q: string,
  limit: number,
  mongoFallback: (
    q: string,
    option: { offset: number; limit: number },
  ) => Promise<string[]>,
): Promise<string[]> {
  if (backend.isReachable) {
    try {
      return await backend.fullTextSearchDelegator.searchAuditlogByFuzzyWildcard(
        field,
        q,
        limit,
      );
    } catch (err) {
      logger.error(
        { err },
        `Failed to search auditlog suggestions (${field}) on Elasticsearch. Falling back to MongoDB.`,
      );
    }
  }
  if (q.length < AUDITLOG_SUGGESTION_FALLBACK_MIN_QUERY_LENGTH[field]) {
    return [];
  }
  return mongoFallback(q, { offset: 0, limit });
}

// searchAuditlogSuggestions dispatches through this map, so a new field (e.g.
// `ip`) needs no change there.
const AUDITLOG_SUGGESTION_HANDLERS: {
  [K in AuditlogSuggestionField]: (
    backend: AuditlogSuggestionBackend,
    q: string,
    limit: number,
  ) => Promise<AuditlogSuggestionsResponse>;
} = {
  async username(backend, q, limit) {
    const usernames = await searchAuditlogFieldValues(
      backend,
      'username',
      q,
      limit,
      // Wrapped, not passed directly: the Prisma extension method reads
      // `this` via Prisma.getExtensionContext, so passing it as a bare
      // reference would detach it from `prisma.activities` and throw.
      (query, option) =>
        prisma.activities.findSnapshotUsernamesByUsernameRegex(query, option),
    );

    const User = mongoose.model<IUser>('User');
    const users =
      usernames.length === 0
        ? []
        : await User.find({ username: { $in: usernames } })
            .select('username status')
            .lean();

    const activeUsernames = new Set(
      users
        .filter((u) => u.status === UserStatus.STATUS_ACTIVE)
        .map((u) => u.username),
    );

    // A username with no live User match (e.g. deleted -- statusDelete()
    // renames the User doc's username to `deleted_at_*`) must still be
    // searchable in the audit trail, so anything not proven active is
    // treated as inactive rather than silently dropped.
    return {
      username: {
        activeUsernames: usernames.filter((u) => activeUsernames.has(u)),
        inactiveUsernames: usernames.filter((u) => !activeUsernames.has(u)),
      },
    };
  },

  // Unlike username, no User-model classification applies — endpoints have
  // no notion of Active/Inactive.
  async endpoint(backend, q, limit) {
    // Both backends match against the path-only value, so a pasted URL's
    // origin and query string are dropped here once rather than in each backend.
    const pathQ = toEndpointSearchPath(q);
    if (pathQ === '') return { endpoint: { endpoints: [] } };

    const endpoints = await searchAuditlogFieldValues(
      backend,
      'endpoint',
      pathQ,
      limit,
      (query, option) =>
        prisma.activities.findEndpointsByEndpointRegex(query, option),
    );

    return { endpoint: { endpoints } };
  },
};

export const searchAuditlogSuggestions = async (
  backend: AuditlogSuggestionBackend,
  fields: AuditlogSuggestionField[],
  q: string,
  limit: number,
): Promise<AuditlogSuggestionsResponse> => {
  const trimmedQ = q.trim();
  if (trimmedQ === '') return {};

  const uniqueFields = [...new Set(fields)];
  const settled = await Promise.allSettled(
    uniqueFields.map((field) =>
      AUDITLOG_SUGGESTION_HANDLERS[field](backend, trimmedQ, limit),
    ),
  );

  const responses = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  if (settled.length > 0 && responses.length === 0) {
    // Not logged here: the caller logs this error once, with every cause.
    throw new AggregateError(
      settled.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      ),
      'Failed to search auditlog suggestions for all fields.',
    );
  }

  // A failing field is dropped so it can't take the others down with it, and
  // logged since the 200 response does not carry its cause.
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason },
        `Failed to search auditlog suggestions (${uniqueFields[i]}).`,
      );
    }
  });

  return Object.assign({}, ...responses);
};
