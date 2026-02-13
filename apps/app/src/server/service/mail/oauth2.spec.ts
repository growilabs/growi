import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createOAuth2Client } from './oauth2';

describe('createOAuth2Client', () => {
  let mockConfigManager: any;

  beforeEach(() => {
    mockConfigManager = {
      getConfig: vi.fn(),
    };
  });

  const validCredentials = (
    overrides: Record<string, string | null> = {},
  ): void => {
    mockConfigManager.getConfig.mockImplementation((key: string) => {
      const defaults: Record<string, string> = {
        'mail:oauth2ClientId': 'client-id.apps.googleusercontent.com',
        'mail:oauth2ClientSecret': 'client-secret-value',
        'mail:oauth2RefreshToken': 'refresh-token-value',
        'mail:oauth2User': 'user@gmail.com',
      };
      return key in overrides ? overrides[key] : defaults[key];
    });
  };

  describe('credential validation with type guards', () => {
    it('should return null when clientId is missing', () => {
      validCredentials({ 'mail:oauth2ClientId': null });

      const result = createOAuth2Client(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when clientSecret is missing', () => {
      validCredentials({ 'mail:oauth2ClientSecret': null });

      const result = createOAuth2Client(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when refreshToken is missing', () => {
      validCredentials({ 'mail:oauth2RefreshToken': null });

      const result = createOAuth2Client(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when user is missing', () => {
      validCredentials({ 'mail:oauth2User': null });

      const result = createOAuth2Client(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when clientId is empty string', () => {
      validCredentials({ 'mail:oauth2ClientId': '' });

      const result = createOAuth2Client(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when clientId is whitespace only', () => {
      validCredentials({ 'mail:oauth2ClientId': '   ' });

      const result = createOAuth2Client(mockConfigManager);

      expect(result).toBeNull();
    });
  });

  describe('transport creation', () => {
    it('should create transport with valid credentials', () => {
      validCredentials();

      const result = createOAuth2Client(mockConfigManager);

      expect(result).not.toBeNull();
      expect(result?.options).toMatchObject({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: 'user@gmail.com',
          clientId: 'client-id.apps.googleusercontent.com',
          clientSecret: 'client-secret-value',
          refreshToken: 'refresh-token-value',
        },
      });
    });
  });

  describe('option parameter override', () => {
    it('should use provided option instead of config when option is passed', () => {
      const customOption = {
        service: 'gmail' as const,
        auth: {
          type: 'OAuth2' as const,
          user: 'custom@gmail.com',
          clientId: 'custom-client-id',
          clientSecret: 'custom-secret',
          refreshToken: 'custom-token',
        },
      };

      const result = createOAuth2Client(mockConfigManager, customOption);

      expect(result).not.toBeNull();
      expect(mockConfigManager.getConfig).not.toHaveBeenCalled();
    });
  });
});
