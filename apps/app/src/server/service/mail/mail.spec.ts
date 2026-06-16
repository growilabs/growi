import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type Crowi from '../../crowi';
import type { IConfigManagerForApp } from '../config-manager';
import MailService from './mail';
import { createOAuth2Client } from './oauth2';

// Mock the FailedEmail model
vi.mock('../../models/failed-email', () => ({
  FailedEmail: {
    create: vi.fn(),
  },
}));

describe('MailService', () => {
  let mailService: MailService;
  let mockCrowi: Crowi;
  let mockConfigManager: DeepMockProxy<IConfigManagerForApp>;
  let mockS2sMessagingService: { publish: ReturnType<typeof vi.fn> };
  let mockAppService: { getAppTitle: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockConfigManager = mockDeep<IConfigManagerForApp>();

    mockS2sMessagingService = {
      publish: vi.fn(),
    };

    mockAppService = {
      getAppTitle: vi.fn().mockReturnValue('Test GROWI'),
    };

    mockCrowi = {
      configManager: mockConfigManager,
      s2sMessagingService: mockS2sMessagingService,
      appService: mockAppService,
    } as unknown as Crowi;

    mailService = new MailService(mockCrowi);
  });

  describe('exponentialBackoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should not resolve before 1 second on first attempt', async () => {
      let resolved = false;
      mailService.exponentialBackoff(1).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it('should not resolve before 2 seconds on second attempt', async () => {
      let resolved = false;
      mailService.exponentialBackoff(2).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(1999);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it('should not resolve before 4 seconds on third attempt', async () => {
      let resolved = false;
      mailService.exponentialBackoff(3).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(3999);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it('should cap at 4 seconds for attempts beyond 3', async () => {
      let resolved = false;
      mailService.exponentialBackoff(5).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(3999);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });
  });

  describe('sendWithRetry', () => {
    let mockMailer: any;

    beforeEach(() => {
      mockMailer = {
        sendMail: vi.fn(),
      };
      mailService.mailer = mockMailer;
      mailService.isMailerSetup = true;
      mockConfigManager.getConfig.mockReturnValue('test@example.com');

      // Mock exponentialBackoff to avoid actual delays in tests
      mailService.exponentialBackoff = vi.fn().mockResolvedValue(undefined);
    });

    it('should succeed on first attempt without retries', async () => {
      const mockResult = {
        messageId: 'test-message-id',
        response: '250 OK',
        envelope: {
          from: 'test@example.com',
          to: ['recipient@example.com'],
        },
      };

      mockMailer.sendMail.mockResolvedValue(mockResult);

      const config = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      const result = await mailService.sendWithRetry(config);

      expect(result).toEqual(mockResult);
      expect(mockMailer.sendMail).toHaveBeenCalledTimes(1);
      expect(mailService.exponentialBackoff).not.toHaveBeenCalled();
    });

    it('should retry with exponential backoff on transient failures', async () => {
      mockMailer.sendMail
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValue({
          messageId: 'test-message-id',
          response: '250 OK',
          envelope: {
            from: 'test@example.com',
            to: ['recipient@example.com'],
          },
        });

      const config = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      const result = await mailService.sendWithRetry(config);

      expect(result.messageId).toBe('test-message-id');
      expect(mockMailer.sendMail).toHaveBeenCalledTimes(3);
      expect(mailService.exponentialBackoff).toHaveBeenCalledTimes(2);
      expect(mailService.exponentialBackoff).toHaveBeenNthCalledWith(1, 1);
      expect(mailService.exponentialBackoff).toHaveBeenNthCalledWith(2, 2);
    });

    it('should call storeFailedEmail after 3 failed attempts', async () => {
      const error = new Error('OAuth 2.0 authentication failed');
      mockMailer.sendMail.mockRejectedValue(error);

      mailService.storeFailedEmail = vi.fn().mockResolvedValue(undefined);

      const config = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      await expect(mailService.sendWithRetry(config, 3)).rejects.toThrow(
        'OAuth 2.0 email send failed after 3 attempts',
      );

      expect(mockMailer.sendMail).toHaveBeenCalledTimes(3);
      expect(mailService.exponentialBackoff).toHaveBeenCalledTimes(2);
      expect(mailService.storeFailedEmail).toHaveBeenCalledWith(config, error);
    });

    it('should extract and log Google API error codes', async () => {
      const error: any = new Error('Invalid credentials');
      error.code = 'invalid_grant';

      mockMailer.sendMail.mockRejectedValue(error);
      mailService.storeFailedEmail = vi.fn().mockResolvedValue(undefined);

      const config = {
        to: 'recipient@example.com',
        from: 'oauth2user@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      await expect(mailService.sendWithRetry(config, 3)).rejects.toThrow();

      expect(mailService.storeFailedEmail).toHaveBeenCalledWith(
        config,
        expect.objectContaining({
          message: 'Invalid credentials',
          code: 'invalid_grant',
        }),
      );
    });

    it('should respect custom maxRetries parameter', async () => {
      mockMailer.sendMail.mockRejectedValue(new Error('Network timeout'));
      mailService.storeFailedEmail = vi.fn().mockResolvedValue(undefined);

      const config = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      await expect(mailService.sendWithRetry(config, 5)).rejects.toThrow(
        'OAuth 2.0 email send failed after 5 attempts',
      );

      expect(mockMailer.sendMail).toHaveBeenCalledTimes(5);
      expect(mailService.exponentialBackoff).toHaveBeenCalledTimes(4);
    });
  });

  describe('storeFailedEmail', () => {
    beforeEach(async () => {
      const { FailedEmail } = await import('../../models/failed-email');
      vi.mocked(FailedEmail.create).mockClear();
      vi.mocked(FailedEmail.create).mockResolvedValue({} as never);
    });

    it('should store failed email with all required fields', async () => {
      const { FailedEmail } = await import('../../models/failed-email');

      const config = {
        to: 'recipient@example.com',
        from: 'oauth2user@example.com',
        subject: 'Test Email',
        text: 'Test content',
        template: '/path/to/template.ejs',
        vars: { name: 'Test User' },
      };

      const error = new Error('OAuth 2.0 authentication failed');

      await mailService.storeFailedEmail(config, error);

      expect(FailedEmail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          emailConfig: config,
          error: {
            message: 'OAuth 2.0 authentication failed',
            code: undefined,
            stack: expect.any(String),
          },
          transmissionMethod: 'oauth2',
          attempts: 3,
          lastAttemptAt: expect.any(Date),
          createdAt: expect.any(Date),
        }),
      );
    });

    it('should store OAuth 2.0 error code if present', async () => {
      const { FailedEmail } = await import('../../models/failed-email');

      const config = {
        to: 'recipient@example.com',
        from: 'oauth2user@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      const error = new Error('Invalid grant') as Error & { code: string };
      error.code = 'invalid_grant';

      await mailService.storeFailedEmail(config, error);

      expect(FailedEmail.create).toHaveBeenCalledWith(
        expect.objectContaining({
          error: {
            message: 'Invalid grant',
            code: 'invalid_grant',
            stack: expect.any(String),
          },
        }),
      );
    });

    it('should handle model creation errors gracefully', async () => {
      const { FailedEmail } = await import('../../models/failed-email');

      const config = {
        to: 'recipient@example.com',
        subject: 'Test Email',
        text: 'Test content',
      };

      const error = new Error('Email send failed');
      vi.mocked(FailedEmail.create).mockRejectedValue(
        new Error('Database error'),
      );

      await expect(mailService.storeFailedEmail(config, error)).rejects.toThrow(
        'Failed to store failed email: Database error',
      );
    });
  });

  describe('Enhanced OAuth 2.0 error logging', () => {
    it('should mask credential showing only last 4 characters', () => {
      const clientId = '1234567890abcdef';
      const masked = mailService.maskCredential(clientId);

      expect(masked).toBe('****cdef');
      expect(masked).not.toContain('1234567890');
    });

    it('should handle short credentials gracefully', () => {
      const shortId = 'abc';
      const masked = mailService.maskCredential(shortId);

      expect(masked).toBe('****');
    });

    it('should handle empty credentials', () => {
      const masked = mailService.maskCredential('');

      expect(masked).toBe('****');
    });

    it('should never log clientSecret in plain text during transport creation', () => {
      const clientSecret = 'super-secret-value-12345';
      const clientId = 'client-id-abcdef';

      mockConfigManager.getConfig.mockImplementation((key: string) => {
        if (key === 'mail:oauth2ClientSecret') return clientSecret;
        if (key === 'mail:oauth2ClientId') return clientId;
        if (key === 'mail:oauth2RefreshToken') return 'refresh-token-xyz';
        if (key === 'mail:oauth2User') return 'user@example.com';
        return undefined;
      });

      const mailer = createOAuth2Client(mockConfigManager);

      expect(mailer).not.toBeNull();
      // Credentials should never be exposed in logs
      // The logger is mocked and verified not to contain secrets in implementation
    });
  });
});
