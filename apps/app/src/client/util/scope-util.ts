import { ALL_SIGN, type Scope } from '@growi/core/dist/interfaces';

// Data structure for the final merged scopes
interface ScopeMap {
  [key: string]: Scope | ScopeMap;
}

// Input object with arbitrary action keys (e.g., READ, WRITE)
type ScopesInput = Record<string, any>;

function parseSubScope(
  parentKey: string,
  subObjForActions: Record<string, any>,
  actions: string[],
): ScopeMap {
  const result: ScopeMap = {};

  for (const action of actions) {
    if (typeof subObjForActions[action] === 'string') {
      result[`${action.toLowerCase()}:${parentKey.toLowerCase()}`] =
        subObjForActions[action];
      subObjForActions[action] = undefined;
    }
  }

  const childKeys = new Set<string>();
  for (const action of actions) {
    const obj = subObjForActions[action];
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach((k) => {
        childKeys.add(k);
      });
    }
  }

  for (const ck of childKeys) {
    if (ck === 'ALL') {
      for (const action of actions) {
        const val = subObjForActions[action]?.[ck];
        if (typeof val === 'string') {
          result[`${action.toLowerCase()}:${parentKey.toLowerCase()}:all`] =
            val as Scope;
        }
      }
      continue;
    }

    const newKey = `${parentKey}:${ck}`;
    const childSubObj: Record<string, any> = {};
    for (const action of actions) {
      childSubObj[action] = subObjForActions[action]?.[ck];
    }

    result[newKey] = parseSubScope(newKey, childSubObj, actions);
  }

  return result;
}

export function parseScopes({
  scopes,
  isAdmin = false,
}: {
  scopes: ScopesInput;
  isAdmin?: boolean;
}): ScopeMap {
  const actions = Object.keys(scopes);
  const topKeys = new Set<string>();

  // Collect all top-level keys (e.g., ALL, ADMIN, USER) across all actions
  for (const action of actions) {
    Object.keys(scopes[action] || {}).forEach((k) => {
      topKeys.add(k);
    });
  }

  const result: ScopeMap = {};

  for (const key of topKeys) {
    // Skip 'ADMIN' key if isAdmin is true
    if (!isAdmin && (key === 'ADMIN' || key === 'ALL')) {
      continue;
    }

    if (key === 'ALL') {
      const allObj: ScopeMap = {};
      for (const action of actions) {
        const val = scopes[action]?.[key];
        if (typeof val === 'string') {
          allObj[`${action.toLowerCase()}:all`] = val as Scope;
        }
      }
      result.ALL = allObj;
    } else {
      const subObjForActions: Record<string, any> = {};
      for (const action of actions) {
        subObjForActions[action] = scopes[action]?.[key];
      }
      result[key] = parseSubScope(key, subObjForActions, actions);
    }
  }

  return result;
}

/**
 * Determines which scopes should be disabled based on wildcard selections
 */
export function getDisabledScopes(
  selectedScopes: Scope[],
  availableScopes: string[],
): Set<Scope> {
  const disabledSet = new Set<Scope>();

  // If no selected scopes, return empty set
  if (!selectedScopes || selectedScopes.length === 0) {
    return disabledSet;
  }

  selectedScopes.forEach((scope) => {
    // Check if the scope is in the form `xxx:*`
    if (scope.endsWith(`:${ALL_SIGN}`)) {
      // Convert something like `read:*` into the prefix `read:`
      const prefix = scope.replace(`:${ALL_SIGN}`, ':');

      // Disable all scopes that start with the prefix (but are not the selected scope itself)
      availableScopes.forEach((s: Scope) => {
        if (s.startsWith(prefix) && s !== scope) {
          disabledSet.add(s);
        }
      });
    }
  });

  return disabledSet;
}

/**
 * Extracts all scope strings from a nested ScopeMap object
 */
export function extractScopes(obj: Record<string, any>): string[] {
  let result: string[] = [];

  Object.values(obj).forEach((value) => {
    if (typeof value === 'string') {
      result.push(value);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      result = result.concat(extractScopes(value));
    }
  });

  return result;
}
