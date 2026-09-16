// Per-endpoint cap (admitted anonymous-log events per 1-minute window, all IPs combined)
// on syncing anonymous audit logs to Elasticsearch. See decide-es-sync-for-event.ts for
// how this is applied, and pr-11627-implementation-proposal.md section 4-③ for the
// reasoning behind sourcing these from env vars rather than the existing rate-limiter
// config (that config encodes an unrelated "users behind one IP" assumption).
//
// DEFAULT_THRESHOLD_PER_MINUTE (100) is a launch placeholder, not a tuned value: it
// reuses app:elasticsearchReindexBulkSize's own default (config-definition.ts), i.e. the
// chunk size ES already handles routinely in a single bulk write during a full reindex —
// so it is clearly within the cluster's normal tolerance, without inventing a new number.
// GROWI.cloud is expected to replace it per-endpoint once real traffic data is available
// (separate task; see the proposal doc).
const DEFAULT_THRESHOLD_PER_MINUTE = 100;

const parseThreshold = (envVarName: string): number => {
  const raw = process.env[envVarName];
  if (raw == null || raw === '') return DEFAULT_THRESHOLD_PER_MINUTE;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_THRESHOLD_PER_MINUTE;
};

export type AnonymousSyncThresholdMap = { [endpoint: string]: number };

// Regex-keyed, matching the shape of rate-limiter's defaultConfigWithRegExp so the two
// stay visually comparable even though their value sources differ.
export const anonymousSyncThresholds: AnonymousSyncThresholdMap = {
  '/login': parseThreshold('ANONYMOUS_ES_SYNC_THRESHOLD_LOGIN'),
  '/register': parseThreshold('ANONYMOUS_ES_SYNC_THRESHOLD_REGISTER'),
  '/forgot-password/.*': parseThreshold(
    'ANONYMOUS_ES_SYNC_THRESHOLD_FORGOT_PASSWORD',
  ),
};
