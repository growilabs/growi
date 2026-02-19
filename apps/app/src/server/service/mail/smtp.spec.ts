import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { IConfigManagerForApp } from '../config-manager';
import { createSMTPClient } from './smtp';

describe('createSMTPClient', () => {
  let mockConfigManager: DeepMockProxy<IConfigManagerForApp>;

  beforeEach(() => {
    mockConfigManager = mockDeep<IConfigManagerForApp>();
  });

  describe('credential validation', () => {
    it('should return null when host is missing', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return undefined;
        if (key === 'mail:smtpPort') return 587;
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when port is missing', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return 'smtp.example.com';
        if (key === 'mail:smtpPort') return undefined;
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).toBeNull();
    });

    it('should return null when both host and port are missing', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return undefined;
        if (key === 'mail:smtpPort') return undefined;
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).toBeNull();
    });
  });

  describe('transport creation', () => {
    it('should create transport with host and port only', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return 'smtp.example.com';
        if (key === 'mail:smtpPort') return 587;
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).not.toBeNull();
      expect(result?.options).toMatchObject({
        host: 'smtp.example.com',
        port: 587,
        tls: { rejectUnauthorized: false },
      });
    });

    it('should include auth when user and password are provided', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return 'smtp.example.com';
        if (key === 'mail:smtpPort') return 587;
        if (key === 'mail:smtpUser') return 'testuser';
        if (key === 'mail:smtpPassword') return 'testpass';
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).not.toBeNull();
      expect(result?.options).toMatchObject({
        host: 'smtp.example.com',
        port: 587,
        auth: {
          user: 'testuser',
          pass: 'testpass',
        },
        tls: { rejectUnauthorized: false },
      });
    });

    it('should set secure: true for port 465', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return 'smtp.example.com';
        if (key === 'mail:smtpPort') return 465;
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).not.toBeNull();
      expect(result?.options).toMatchObject({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        tls: { rejectUnauthorized: false },
      });
    });

    it('should not set secure: true for port 587', () => {
      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:smtpHost') return 'smtp.example.com';
        if (key === 'mail:smtpPort') return 587;
        return undefined;
      });

      const result = createSMTPClient(mockConfigManager);

      expect(result).not.toBeNull();
      expect(
        (result?.options as Record<string, unknown>).secure,
      ).toBeUndefined();
    });
  });

  describe('option parameter override', () => {
    it('should use provided option instead of config when option is passed', () => {
      const customOption = {
        host: 'custom.smtp.com',
        port: 2525,
        auth: {
          user: 'customuser',
          pass: 'custompass',
        },
      };

      const result = createSMTPClient(mockConfigManager, customOption);

      expect(result).not.toBeNull();
      expect(result?.options).toMatchObject({
        host: 'custom.smtp.com',
        port: 2525,
        auth: {
          user: 'customuser',
          pass: 'custompass',
        },
        tls: { rejectUnauthorized: false },
      });
      expect(mockConfigManager.getConfig).not.toHaveBeenCalled();
    });
  });
});
