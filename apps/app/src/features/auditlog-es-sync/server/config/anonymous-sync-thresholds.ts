import { configManager } from '~/server/service/config-manager';

// A narrow union (not the full ConfigKey) so configManager.getConfig(...) resolves to
// `number` below without a cast — widening this to ConfigKey would make the lookup
// resolve to the union of every config value type in the app.
type AnonymousSyncThresholdConfigKey =
  | 'app:auditLogEsSyncAnonymousThresholdLogin'
  | 'app:auditLogEsSyncAnonymousThresholdRegister'
  | 'app:auditLogEsSyncAnonymousThresholdForgotPassword'
  | 'app:auditLogEsSyncAnonymousThresholdInstaller';

// Per-endpoint cap (admitted anonymous-log events per 1-minute window, all IPs combined)
// on syncing anonymous audit logs to Elasticsearch. See decide-es-sync-for-event.ts for
// how this is applied.
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

export const getAnonymousSyncThreshold = (thresholdKey: string): number =>
  configManager.getConfig(anonymousSyncThresholdConfigKeys[thresholdKey]);
