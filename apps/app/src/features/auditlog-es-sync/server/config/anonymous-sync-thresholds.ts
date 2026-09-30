import { configManager } from '~/server/service/config-manager';
import { CONFIG_DEFINITIONS } from '~/server/service/config-manager/config-definition';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:auditlog-es-sync:anonymous-sync-thresholds',
);

// A narrow union (not the full ConfigKey) so configManager.getConfig(...) resolves to
// `number` below without a cast — widening this to ConfigKey would make the lookup
// resolve to the union of every config value type in the app.
type AnonymousSyncThresholdConfigKey =
  | 'app:auditLogEsSyncAnonymousThresholdLogin'
  | 'app:auditLogEsSyncAnonymousThresholdRegister'
  | 'app:auditLogEsSyncAnonymousThresholdForgotPassword'
  | 'app:auditLogEsSyncAnonymousThresholdInstaller'
  | 'app:auditLogEsSyncAnonymousThresholdOther';

// Per-endpoint cap (admitted anonymous-log events per 1-minute window, all IPs combined)
// on syncing anonymous audit logs to Elasticsearch. See decide-es-sync-for-event.ts for
// how this is applied.
//
// Endpoints listed here have their own counter and threshold, derived from their own
// rate-limiter entry. Every other anonymous log shares a single counter under
// OTHER_ENDPOINTS_THRESHOLD_KEY — one shared bucket, not one per path, because an
// attacker controls the path and could otherwise spread a flood across unbounded keys.
//
// Keys are `req.originalUrl` shapes (see add-activity.ts) — always carrying GROWI's
// `/_api/v3` prefix, since a bare route path (e.g. '/login') never matches real traffic.
//
// Values point at configManager keys (config-definition.ts), not raw numbers, so
// operators (including GROWI.cloud) can override a threshold at runtime via the
// existing DB-backed config store, without a redeploy.
export type AnonymousSyncThresholdConfigKeyMap = {
  [endpoint: string]: AnonymousSyncThresholdConfigKey;
};

// Regex-keyed, matching the shape of rate-limiter's defaultConfigWithRegExp so the two
// stay visually comparable even though their value sources differ.
export const anonymousSyncThresholdConfigKeys: AnonymousSyncThresholdConfigKeyMap =
  {
    '/_api/v3/login': 'app:auditLogEsSyncAnonymousThresholdLogin',
    '/_api/v3/register': 'app:auditLogEsSyncAnonymousThresholdRegister',
    '/_api/v3/forgot-password':
      'app:auditLogEsSyncAnonymousThresholdForgotPassword',
    '/_api/v3/installer': 'app:auditLogEsSyncAnonymousThresholdInstaller',
  };

// Cannot collide with a listed key: every listed key starts with '/'.
export const OTHER_ENDPOINTS_THRESHOLD_KEY = '*';

const resolveConfigKey = (
  thresholdKey: string,
): AnonymousSyncThresholdConfigKey =>
  anonymousSyncThresholdConfigKeys[thresholdKey] ??
  'app:auditLogEsSyncAnonymousThresholdOther';

const isValidThreshold = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Config keys already reported as invalid. This is called once per anonymous event,
// so logging on every call would flood the log during exactly the attack traffic the
// threshold exists for.
const reportedInvalidConfigKeys = new Set<AnonymousSyncThresholdConfigKey>();

// A non-numeric value (e.g. `abc` via parseInt) becomes NaN, which silently drops
// every anonymous event at the endpoint: every `count <= NaN` comparison is false.
// Fall back to the default instead.
export const getAnonymousSyncThreshold = (thresholdKey: string): number => {
  const configKey = resolveConfigKey(thresholdKey);
  const value: unknown = configManager.getConfig(configKey);
  if (isValidThreshold(value)) return value;

  const { defaultValue } = CONFIG_DEFINITIONS[configKey];
  if (!reportedInvalidConfigKeys.has(configKey)) {
    reportedInvalidConfigKeys.add(configKey);
    logger.error(
      { configKey, value, defaultValue },
      'Invalid anonymous log ES sync threshold; falling back to the default.',
    );
  }
  return defaultValue;
};
