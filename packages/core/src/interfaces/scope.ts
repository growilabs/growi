// SCOPE_SEED defines the basic scope structure.
// When you need to set different permissions for Admin and User
// on specific endpoints (like /me), use SCOPE rather than modifying SCOPE_SEED.

// If you want to add a new scope, you only need to add a new key to the SCOPE_SEED object.

// Change translation file contents (accesstoken_scopes_desc) when scope structure is modified

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

type FlattenObject<T> = {
  [K in keyof T]: T[K] extends object
    ? keyof T[K] extends never
      ? K
      : `${K & string}:${FlattenObject<T[K]> & string}`
    : K;
}[keyof T];

type AddAllToScope<S extends string> = S extends `${infer X}:${infer Y}`
  ? `${X}:${typeof ALL_SIGN}` | `${X}:${AddAllToScope<Y>}` | S
  : S;

type ScopeOnly = FlattenObject<typeof SCOPE_SEED_WITH_ACTION>;
type ScopeWithAll = AddAllToScope<ScopeOnly>;
export type Scope = ScopeOnly | ScopeWithAll;

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
