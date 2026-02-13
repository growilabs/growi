import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSESClient } from './ses';

describe('createSESClient', () => {
  let mockConfigManager: any;

  beforeEach(() => {
    mockConfigManager = {
      getConfig: vi.fn(),
    };
  });

  describe('credential validation', () => {
    it('should return null when accessKeyId is missing', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:sesAccessKeyId') return null;
        if (key === 'mail:sesSecretAccessKey') return 'secretKey123';
        return undefined;
      });

      const result = createSESClient(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when secretAccessKey is missing', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:sesAccessKeyId') return 'AKIAIOSFODNN7EXAMPLE';
        if (key === 'mail:sesSecretAccessKey') return null;
        return undefined;
      });

      const result = createSESClient(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when both credentials are missing', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:sesAccessKeyId') return null;
        if (key === 'mail:sesSecretAccessKey') return null;
        return undefined;
      });

      const result = createSESClient(mockConfigManager);

      expect(result).toBeNull();
    });
  });

  describe('transport creation', () => {
    it('should create transport with AWS credentials', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:sesAccessKeyId') return 'AKIAIOSFODNN7EXAMPLE';
        if (key === 'mail:sesSecretAccessKey')
          return 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
        return undefined;
      });

      const result = createSESClient(mockConfigManager);

      expect(result).not.toBeNull();
      // SES transport uses nodemailer-ses-transport wrapper, so we check for transport object
      expect(result?.transporter).toBeDefined();
    });
  });

  describe('option parameter override', () => {
    it('should use provided option instead of config when option is passed', () => {
      const customOption = {
        accessKeyId: 'CUSTOM_ACCESS_KEY',
        secretAccessKey: 'CUSTOM_SECRET_KEY',
      };

      const result = createSESClient(mockConfigManager, customOption);

      expect(result).not.toBeNull();
      expect(mockConfigManager.getConfig).not.toHaveBeenCalled();
    });
  });
});
