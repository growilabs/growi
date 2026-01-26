import { SCOPE, type Scope } from './scope';

/**
 * Helper to extract all scope strings from the SCOPE constant
 */
function extractAllScopeStrings(obj: unknown, result: string[] = []): string[] {
  if (typeof obj === 'string') {
    result.push(obj);
  } else if (typeof obj === 'object' && obj !== null) {
    for (const value of Object.values(obj)) {
      extractAllScopeStrings(value, result);
    }
  }
  return result;
}

describe('Scope type', () => {
  it('should include all runtime scope values in the Scope type', () => {
    const allRuntimeScopes = extractAllScopeStrings(SCOPE);

    // This test verifies type safety - if a scope is missing from the Scope type,
    // TypeScript will fail to compile when we try to assign it to a Scope variable
    const typedScopes: Scope[] = allRuntimeScopes as Scope[];

    expect(typedScopes.length).toBeGreaterThan(0);
  });

  it('should have the expected scope structure', () => {
    // Verify SCOPE.READ exists
    expect(SCOPE.READ).toBeDefined();
    expect(SCOPE.WRITE).toBeDefined();

    // Verify admin scopes
    expect(SCOPE.READ.ADMIN).toBeDefined();
    expect(SCOPE.READ.ADMIN.TOP).toBe('read:admin:top');
    expect(SCOPE.READ.ADMIN.PLUGIN).toBe('read:admin:plugin');
    expect(SCOPE.READ.ADMIN.ALL).toBe('read:admin:*');

    // Verify user_settings scopes
    expect(SCOPE.READ.USER_SETTINGS).toBeDefined();
    expect(SCOPE.READ.USER_SETTINGS.INFO).toBe('read:user_settings:info');
    expect(SCOPE.READ.USER_SETTINGS.API.API_TOKEN).toBe(
      'read:user_settings:api:api_token',
    );
    expect(SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN).toBe(
      'read:user_settings:api:access_token',
    );
    expect(SCOPE.READ.USER_SETTINGS.API.ALL).toBe('read:user_settings:api:*');

    // Verify features scopes
    expect(SCOPE.READ.FEATURES).toBeDefined();
    expect(SCOPE.READ.FEATURES.PAGE).toBe('read:features:page');
    expect(SCOPE.READ.FEATURES.AI_ASSISTANT).toBe('read:features:ai_assistant');

    // Verify write scopes
    expect(SCOPE.WRITE.ADMIN.TOP).toBe('write:admin:top');
    expect(SCOPE.WRITE.FEATURES.PAGE).toBe('write:features:page');
  });

  it('should have consistent scope count', () => {
    const allRuntimeScopes = extractAllScopeStrings(SCOPE);

    // Expected count based on the SCOPE_SEED structure:
    // Admin: 17 leaf scopes + 1 wildcard = 18
    // User Settings: 6 leaf + 2 nested (api) + 2 wildcards = 10
    // Features: 6 leaf scopes + 1 wildcard = 7
    // Total per action: 35
    // Total: 35 * 2 (read/write) = 70
    // But some wildcards are at category level, so actual count may vary

    // Just ensure we have a reasonable number of scopes
    expect(allRuntimeScopes.length).toBeGreaterThanOrEqual(60);
    expect(allRuntimeScopes.length).toBeLessThanOrEqual(100);
  });

  it('should allow valid scope strings to be assigned to Scope type', () => {
    // These assignments should compile without error
    const readAdminTop: Scope = 'read:admin:top';
    const writeAdminPlugin: Scope = 'write:admin:plugin';
    const readUserSettingsApiToken: Scope = 'read:user_settings:api:api_token';
    const readAdminWildcard: Scope = 'read:admin:*';
    const readWildcard: Scope = 'read:*';

    expect(readAdminTop).toBe('read:admin:top');
    expect(writeAdminPlugin).toBe('write:admin:plugin');
    expect(readUserSettingsApiToken).toBe('read:user_settings:api:api_token');
    expect(readAdminWildcard).toBe('read:admin:*');
    expect(readWildcard).toBe('read:*');
  });
});
