import { SCOPE } from '@growi/core/dist/interfaces';
import { describe, it, expect } from 'vitest';


import {
  isValidScope, hasAllScope, extractAllScope, extractScopes,
} from './scope-utils';

describe('scope-utils', () => {
  describe('isValidScope', () => {
    it('should return true for valid scopes', () => {
      expect(isValidScope(SCOPE.READ.USER_SETTINGS.API.API_TOKEN)).toBe(true);
      expect(isValidScope(SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN)).toBe(true);
      expect(isValidScope(SCOPE.READ.ADMIN.APP)).toBe(true);
    });

    it('should return false for invalid scopes', () => {
      expect(isValidScope('invalid:scope' as any)).toBe(false);
      expect(isValidScope('read:invalid:path' as any)).toBe(false);
      expect(isValidScope('write:user:invalid' as any)).toBe(false);
    });
  });

  describe('hasAllScope', () => {
    it('should return true for scopes ending with *', () => {
      expect(hasAllScope(SCOPE.READ.USER_SETTINGS.API.ALL)).toBe(true);
      expect(hasAllScope(SCOPE.WRITE.ADMIN.ALL)).toBe(true);
    });

    it('should return false for specific scopes', () => {
      expect(hasAllScope(SCOPE.READ.USER_SETTINGS.API.API_TOKEN)).toBe(false);
      expect(hasAllScope(SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN)).toBe(false);
    });
  });

  describe('extractAllScope', () => {
    it('should extract all specific scopes from ALL scope', () => {
      const extracted = extractAllScope(SCOPE.READ.USER_SETTINGS.API.ALL);
      expect(extracted).toContain(SCOPE.READ.USER_SETTINGS.API.API_TOKEN);
      expect(extracted).toContain(SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN);
      expect(extracted).not.toContain(SCOPE.READ.USER_SETTINGS.API.ALL);
    });

    it('should return array with single scope for specific scope', () => {
      const scope = SCOPE.READ.USER_SETTINGS.API.API_TOKEN;
      const extracted = extractAllScope(scope);
      expect(extracted).toEqual([scope]);
    });
  });

  describe('extractScopes', () => {
    it('should return empty array for undefined input', () => {
      expect(extractScopes()).toEqual([]);
    });

    it('should extract all implied scopes including READ permission for WRITE scopes', () => {
      const scopes = [SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN];
      const extracted = extractScopes(scopes);

      expect(extracted).toContain(SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN);
      expect(extracted).toContain(SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN);
    });

    it('should extract all specific scopes from ALL scope with implied permissions', () => {
      const scopes = [SCOPE.WRITE.USER_SETTINGS.API.ALL];
      const extracted = extractScopes(scopes);

      // Should include both WRITE and READ permissions for all specific scopes
      expect(extracted).toContain(SCOPE.WRITE.USER_SETTINGS.API.API_TOKEN);
      expect(extracted).toContain(SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN);
      expect(extracted).toContain(SCOPE.READ.USER_SETTINGS.API.API_TOKEN);
      expect(extracted).toContain(SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN);

      // Should not include ALL scopes
      expect(extracted).not.toContain(SCOPE.WRITE.USER_SETTINGS.API.ALL);
      expect(extracted).not.toContain(SCOPE.READ.USER_SETTINGS.API.ALL);
    });

    it('should remove duplicate scopes', () => {
      const scopes = [
        SCOPE.WRITE.USER_SETTINGS.API.ACCESS_TOKEN,
        SCOPE.READ.USER_SETTINGS.API.ACCESS_TOKEN, // This is implied by WRITE
      ];
      const extracted = extractScopes(scopes);

      const accessTokenScopes = extracted.filter(s => s.endsWith('access_token'));
      expect(accessTokenScopes).toHaveLength(2); // Only READ and WRITE, no duplicates
    });
  });
});
