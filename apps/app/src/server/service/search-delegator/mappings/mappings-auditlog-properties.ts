/**
 * Field mappings for the auditlog index, shared by the ES8 and ES9 variants so
 * the two cannot silently drift. Each variant re-types this against its own
 * `estypes`, so a divergence between the client versions is a compile error.
 */
export const auditlogProperties = {
  username: { type: 'keyword' },
  endpoint: { type: 'keyword' },
} as const;
