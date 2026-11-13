import type { Prisma } from '~/generated/prisma/client';
import type { AuditlogSuggestionField } from '~/interfaces/activity';

type AuditlogSuggestionFieldSpec = {
  // Applied by both backends, so ES and the MongoDB fallback match alike.
  readonly caseInsensitive: boolean;
  // ES only (MongoDB has no native fuzzy match). Compares q against the whole
  // stored value, so it only helps a fully typed value.
  readonly fuzzy: boolean;
  // Below this length the MongoDB fallback returns [] instead of grouping
  // most of the collection. ES has no such limit.
  readonly fallbackMinQueryLength: number;
  readonly mongo: {
    readonly fieldPath: string;
    readonly groupKey: Prisma.InputJsonValue;
  };
};

export const AUDITLOG_SUGGESTION_FIELD_SPECS: {
  readonly [K in AuditlogSuggestionField]: AuditlogSuggestionFieldSpec;
} = {
  username: {
    caseInsensitive: true,
    fuzzy: true,
    fallbackMinQueryLength: 2,
    mongo: {
      fieldPath: 'snapshot.username',
      groupKey: '$snapshot.username',
    },
  },
  endpoint: {
    // Endpoints are looked up by path prefix; fuzzy would only add near-miss
    // paths (e.g. `/_api/v3/tags` for `/_api/v3/page`).
    caseInsensitive: false,
    fuzzy: false,
    // Nearly every endpoint shares the `/_api/` prefix, so no length short of
    // `/_api/v3/` narrows the scan; maxTimeMS bounds the load instead.
    fallbackMinQueryLength: 1,
    mongo: {
      fieldPath: 'endpoint',
      // Mongo-side equivalent of sanitizeEndpointForIndex: the stored
      // endpoint keeps its query string, the ES index does not.
      groupKey: { $arrayElemAt: [{ $split: ['$endpoint', '?'] }, 0] },
    },
  },
};
