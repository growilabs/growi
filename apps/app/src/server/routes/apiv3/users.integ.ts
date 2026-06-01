import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

const mockActivityId = '507f1f77bcf86cd799439011';

// Passthrough middleware for testing - skips authentication
const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

// Add activity middleware mock - sets activity in res.locals
const mockAddActivityMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.locals = res.locals || {};
  res.locals.activity = { _id: mockActivityId };
  next();
};

// Mock middlewares using vi.mock (hoisted to top)
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('../../middlewares/add-activity', () => ({
  generateAddActivityMiddleware: () => mockAddActivityMiddleware,
}));

vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: {
    getSiteUrl: vi.fn().mockReturnValue('http://localhost:3000'),
  },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn().mockReturnValue('en_US'),
  },
}));

describe('POST /invite', () => {
  let app: express.Application;
  let crowiMock: Crowi;
  let mockCreateUsersByEmailList: ReturnType<typeof vi.fn>;
  let mockUpdateIsInvitationEmailSended: ReturnType<typeof vi.fn>;
  let mockMailServiceSend: ReturnType<typeof vi.fn>;
  let mockActivityEmit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockCreateUsersByEmailList = vi.fn().mockResolvedValue({
      createdUserList: [],
      existingEmailList: [],
      failedToCreateUserEmailList: [],
    });
    mockUpdateIsInvitationEmailSended = vi.fn().mockResolvedValue(undefined);
    mockMailServiceSend = vi.fn().mockResolvedValue(undefined);
    mockActivityEmit = vi.fn();

    crowiMock = {
      events: {
        activity: { emit: mockActivityEmit },
      },
      models: {
        User: {
          isEmailValid: vi.fn().mockReturnValue(true),
          createUsersByEmailList: mockCreateUsersByEmailList,
          updateIsInvitationEmailSended: mockUpdateIsInvitationEmailSended,
        },
      },
      appService: {
        getAppTitle: vi.fn().mockReturnValue('GROWI'),
      },
      mailService: {
        send: mockMailServiceSend,
      },
      localeDir: '/app/locales/',
    } as unknown as Crowi;

    // Setup express app
    app = express();
    app.use(express.json());

    // Mock apiv3 response helpers
    app.use((_req, res: ApiV3Response, next) => {
      res.apiv3 = (data, statusCode = 200) => res.status(statusCode).json(data);
      res.apiv3Err = (error, statusCode?: number) => {
        // Validation errors are passed as arrays → respond with 400
        const status = statusCode ?? (Array.isArray(error) ? 400 : 500);
        return res.status(status).json({ error });
      };
      next();
    });

    // Reset module cache so each test gets a fresh router (module-level `router`
    // in users.js would otherwise accumulate route handlers across beforeEach calls)
    vi.resetModules();

    // Import and mount the users router
    const usersModule = await import('./users');
    const usersRouterFactory =
      (usersModule as unknown as Record<string, unknown>).default ??
      usersModule;
    if (typeof usersRouterFactory !== 'function') {
      throw new Error('users module does not export a router factory function');
    }
    app.use('/', usersRouterFactory(crowiMock));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  describe('Validation', () => {
    it('should return 400 when shapedEmailList is missing', async () => {
      const response = await request(app).post('/invite').send({});
      expect(response.status).toBe(400);
    });

    it('should return 400 when shapedEmailList is an empty array', async () => {
      const response = await request(app)
        .post('/invite')
        .send({ shapedEmailList: [] });
      expect(response.status).toBe(400);
    });

    it('should return 400 when shapedEmailList contains only invalid email addresses', async () => {
      const response = await request(app)
        .post('/invite')
        .send({ shapedEmailList: ['not-an-email', 'also-invalid'] });
      expect(response.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('User creation', () => {
    it('should return 201 with createdUserList when users are created successfully', async () => {
      const createdUser = {
        email: 'new@example.com',
        password: 'randompass',
        user: { id: 'uid1' },
      };
      mockCreateUsersByEmailList.mockResolvedValue({
        createdUserList: [createdUser],
        existingEmailList: [],
        failedToCreateUserEmailList: [],
      });

      const response = await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['new@example.com'],
          sendEmail: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.createdUserList).toHaveLength(1);
      expect(response.body.existingEmailList).toHaveLength(0);
      expect(response.body.failedEmailList).toHaveLength(0);
    });

    it('should deduplicate email addresses before calling createUsersByEmailList', async () => {
      await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['dup@example.com', 'dup@example.com'],
          sendEmail: false,
        });

      expect(mockCreateUsersByEmailList).toHaveBeenCalledWith([
        'dup@example.com',
      ]);
    });

    it('should return existingEmailList when emails are already registered', async () => {
      mockCreateUsersByEmailList.mockResolvedValue({
        createdUserList: [],
        existingEmailList: ['existing@example.com'],
        failedToCreateUserEmailList: [],
      });

      const response = await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['existing@example.com'],
          sendEmail: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.createdUserList).toHaveLength(0);
      expect(response.body.existingEmailList).toEqual(['existing@example.com']);
      expect(response.body.failedEmailList).toHaveLength(0);
    });

    it('should put whitelist-rejected emails in failedEmailList with reason email_not_in_whitelist', async () => {
      // Simulate a whitelist that rejects the given email
      (
        crowiMock.models.User as unknown as Record<
          string,
          ReturnType<typeof vi.fn>
        >
      ).isEmailValid = vi.fn().mockReturnValue(false);

      const response = await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['blocked@example.com'],
          sendEmail: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.failedEmailList).toHaveLength(1);
      expect(response.body.failedEmailList[0]).toMatchObject({
        email: 'blocked@example.com',
        reason: 'email_not_in_whitelist',
      });
      // createUsersByEmailList must not be called for the rejected email
      expect(mockCreateUsersByEmailList).toHaveBeenCalledWith([]);
    });

    it('should include creation failures in failedEmailList', async () => {
      mockCreateUsersByEmailList.mockResolvedValue({
        createdUserList: [],
        existingEmailList: [],
        failedToCreateUserEmailList: [
          { email: 'fail@example.com', reason: 'DB write error' },
        ],
      });

      const response = await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['fail@example.com'],
          sendEmail: false,
        });

      expect(response.status).toBe(201);
      expect(response.body.failedEmailList).toHaveLength(1);
      expect(response.body.failedEmailList[0]).toMatchObject({
        email: 'fail@example.com',
        reason: 'DB write error',
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('Email sending (sendEmail: true)', () => {
    it('should call mailService.send for each created user', async () => {
      mockCreateUsersByEmailList.mockResolvedValue({
        createdUserList: [
          { email: 'a@example.com', password: 'p1', user: { id: 'id1' } },
          { email: 'b@example.com', password: 'p2', user: { id: 'id2' } },
        ],
        existingEmailList: [],
        failedToCreateUserEmailList: [],
      });

      const response = await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['a@example.com', 'b@example.com'],
          sendEmail: true,
        });

      expect(response.status).toBe(201);
      expect(mockMailServiceSend).toHaveBeenCalledTimes(2);
      // Each created user must be emailed at their own address (not the same one twice)
      expect(mockMailServiceSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'a@example.com' }),
      );
      expect(mockMailServiceSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'b@example.com' }),
      );
    });

    it('should include email-send failures in failedEmailList', async () => {
      mockCreateUsersByEmailList.mockResolvedValue({
        createdUserList: [
          { email: 'user@example.com', password: 'pass', user: { id: 'uid1' } },
        ],
        existingEmailList: [],
        failedToCreateUserEmailList: [],
      });
      mockMailServiceSend.mockRejectedValue(
        new Error('SMTP connection refused'),
      );

      const response = await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['user@example.com'],
          sendEmail: true,
        });

      expect(response.status).toBe(201);
      expect(response.body.failedEmailList).toHaveLength(1);
      expect(response.body.failedEmailList[0]).toMatchObject({
        email: 'user@example.com',
        reason: 'SMTP connection refused',
      });
    });

    it('should not call mailService.send when sendEmail is false', async () => {
      await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['user@example.com'],
          sendEmail: false,
        });

      expect(mockMailServiceSend).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe('Activity event', () => {
    it('should emit an activity update event on success', async () => {
      await request(app)
        .post('/invite')
        .send({
          shapedEmailList: ['user@example.com'],
          sendEmail: false,
        });

      expect(mockActivityEmit).toHaveBeenCalledWith(
        'update',
        mockActivityId,
        expect.objectContaining({
          action: SupportedAction.ACTION_ADMIN_USERS_INVITE,
        }),
      );
    });
  });
});
