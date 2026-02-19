// SCOPE_SEED defines the basic scope structure.
// When you need to set different permissions for Admin and User
// on specific endpoints (like /me), use SCOPE rather than modifying SCOPE_SEED.

// If you want to add a new scope:
// 1. Add a new key to the SCOPE_SEED object below
// 2. Add the corresponding scope strings to the Scope type union at the bottom of this file
// 3. Change translation file contents (accesstoken_scopes_desc) when scope structure is modified

const SCOPE_SEED_ADMIN = {
  admin: {
    top: {},
    app: {},
    security: {},
    markdown: {},
    customize: {},
    import_data: {},
    export_data: {},
    data_transfer: {},
    external_notification: {},
    slack_integration: {},
    legacy_slack_integration: {},
    user_management: {},
    user_group_management: {},
    audit_log: {},
    plugin: {},
    ai_integration: {},
    full_text_search: {},
  },
} as const;

const SCOPE_SEED_USER = {
  user_settings: {
    info: {},
    external_account: {},
    password: {},
    api: {
      api_token: {},
      access_token: {},
    },
    in_app_notification: {},
    other: {},
  },
  features: {
    ai_assistant: {},
    page: {},
    share_link: {},
    bookmark: {},
    attachment: {},
    page_bulk_export: {},
  },
} as const;

const SCOPE_SEED = {
  ...SCOPE_SEED_ADMIN,
  ...SCOPE_SEED_USER,
} as const;

export const ACTION = {
  READ: 'read',
  WRITE: 'write',
} as const;

type ACTION_TYPE = (typeof ACTION)[keyof typeof ACTION];
export const ALL_SIGN = '*';

const SCOPE_SEED_WITH_ACTION = Object.values(ACTION).reduce(
  (acc, action) => {
    acc[action] = SCOPE_SEED;
    return acc;
  },
  {} as Record<ACTION_TYPE, typeof SCOPE_SEED>,
);

// ============================================================================
// SCOPE LITERAL TYPE
// ============================================================================
// This type is explicitly defined to avoid TS2589 "Type instantiation is
// excessively deep" errors that occur with recursive type definitions.
//
// IMPORTANT: When modifying SCOPE_SEED above, update this type union accordingly.
// The scope strings follow the pattern: {action}:{category}[:{subcategory}[:{item}]]
// Wildcard scopes use '*' at any level: {action}:{category}:*
// ============================================================================

// Read scopes - Admin
type ReadAdminScope =
  | 'read:admin:top'
  | 'read:admin:app'
  | 'read:admin:security'
  | 'read:admin:markdown'
  | 'read:admin:customize'
  | 'read:admin:import_data'
  | 'read:admin:export_data'
  | 'read:admin:data_transfer'
  | 'read:admin:external_notification'
  | 'read:admin:slack_integration'
  | 'read:admin:legacy_slack_integration'
  | 'read:admin:user_management'
  | 'read:admin:user_group_management'
  | 'read:admin:audit_log'
  | 'read:admin:plugin'
  | 'read:admin:ai_integration'
  | 'read:admin:full_text_search'
  | 'read:admin:*';

// Read scopes - User Settings
type ReadUserSettingsScope =
  | 'read:user_settings:info'
  | 'read:user_settings:external_account'
  | 'read:user_settings:password'
  | 'read:user_settings:api:api_token'
  | 'read:user_settings:api:access_token'
  | 'read:user_settings:api:*'
  | 'read:user_settings:in_app_notification'
  | 'read:user_settings:other'
  | 'read:user_settings:*';

// Read scopes - Features
type ReadFeaturesScope =
  | 'read:features:ai_assistant'
  | 'read:features:page'
  | 'read:features:share_link'
  | 'read:features:bookmark'
  | 'read:features:attachment'
  | 'read:features:page_bulk_export'
  | 'read:features:*';

// Write scopes - Admin
type WriteAdminScope =
  | 'write:admin:top'
  | 'write:admin:app'
  | 'write:admin:security'
  | 'write:admin:markdown'
  | 'write:admin:customize'
  | 'write:admin:import_data'
  | 'write:admin:export_data'
  | 'write:admin:data_transfer'
  | 'write:admin:external_notification'
  | 'write:admin:slack_integration'
  | 'write:admin:legacy_slack_integration'
  | 'write:admin:user_management'
  | 'write:admin:user_group_management'
  | 'write:admin:audit_log'
  | 'write:admin:plugin'
  | 'write:admin:ai_integration'
  | 'write:admin:full_text_search'
  | 'write:admin:*';

// Write scopes - User Settings
type WriteUserSettingsScope =
  | 'write:user_settings:info'
  | 'write:user_settings:external_account'
  | 'write:user_settings:password'
  | 'write:user_settings:api:api_token'
  | 'write:user_settings:api:access_token'
  | 'write:user_settings:api:*'
  | 'write:user_settings:in_app_notification'
  | 'write:user_settings:other'
  | 'write:user_settings:*';

// Write scopes - Features
type WriteFeaturesScope =
  | 'write:features:ai_assistant'
  | 'write:features:page'
  | 'write:features:share_link'
  | 'write:features:bookmark'
  | 'write:features:attachment'
  | 'write:features:page_bulk_export'
  | 'write:features:*';

// Combined Scope type - all valid scope strings
export type Scope =
  | ReadAdminScope
  | ReadUserSettingsScope
  | ReadFeaturesScope
  | WriteAdminScope
  | WriteUserSettingsScope
  | WriteFeaturesScope
  | 'read:*'
  | 'write:*';

// ScopeConstants type definition
type ScopeConstantLeaf = Scope;

type ScopeConstantNode<T> = {
  [K in keyof T as Uppercase<string & K>]: T[K] extends object
    ? keyof T[K] extends never
      ? ScopeConstantLeaf
      : ScopeConstantNode<T[K]> & { ALL: Scope }
    : ScopeConstantLeaf;
};

type ScopeConstantType = {
  [A in keyof typeof SCOPE_SEED_WITH_ACTION as Uppercase<
    string & A
  >]: ScopeConstantNode<typeof SCOPE_SEED> & { ALL: Scope };
};

const buildScopeConstants = (): ScopeConstantType => {
  const result = {} as Partial<ScopeConstantType>;

  const processObject = (
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    obj: Record<string, any>,
    path: string[] = [],
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    resultObj: Record<string, any>,
  ) => {
    for (const [key, value] of Object.entries(obj)) {
      const upperKey = key.toUpperCase();
      const currentPath = [...path, key];
      const scopePath = currentPath.join(':');

      if (value == null) {
        continue; // Changed from 'return' to 'continue' to match the loop behavior
      }

      if (typeof value === 'object' && Object.keys(value).length === 0) {
        resultObj[upperKey] = `${scopePath}` as Scope;
      } else if (typeof value === 'object') {
        resultObj[upperKey] = {
          ALL: `${scopePath}:${ALL_SIGN}` as Scope,
        };

        processObject(value, currentPath, resultObj[upperKey]);
      }
    }
  };
  processObject(SCOPE_SEED_WITH_ACTION, [], result);

  return result as ScopeConstantType;
};

export const SCOPE = buildScopeConstants();
