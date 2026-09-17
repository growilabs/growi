// tests for assuring axios request succeeds in version change

import type { Server } from 'node:http';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import express from 'express';

import refsMiddleware from '../../server/index.js';
import { useSWRxRef, useSWRxRefs } from './refs.js';

// Mock a Prisma `attachments` row (pageId/creatorId, not page/creator IDs --
// see AttachmentPrismaRow in server/routes/refs.ts) for testing
const mockAttachment = {
  _id: '507f1f77bcf86cd799439011',
  fileFormat: 'image/jpeg',
  fileName: 'test-image.jpg',
  originalName: 'test-image.jpg',
  filePath: 'attachment/507f1f77bcf86cd799439011.jpg',
  pageId: '507f1f77bcf86cd799439013',
  creatorId: '507f1f77bcf86cd799439012',
  creator: {
    _id: '507f1f77bcf86cd799439012',
    name: 'Test User',
    username: 'testuser',
    imageAttachmentId: null,
  },
  createdAt: '2023-01-01T00:00:00.000Z',
  fileSize: 1024000,
};

// Bound once at server setup (mirrors crowi.prisma.attachments being read
// once in routesFactory), so their resolved values must be re-armed in
// beforeEach after vi.restoreAllMocks() clears vi.fn() implementations.
const mockFindFirstAttachment = vi.fn().mockResolvedValue(mockAttachment);
const mockFindManyAttachments = vi.fn().mockResolvedValue([mockAttachment]);

vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();

  // Create a mock constructor for PageQueryBuilder
  class MockPageQueryBuilder {
    addConditionToListWithDescendants = vi.fn().mockReturnThis();
    addConditionToExcludeTrashed = vi.fn().mockReturnThis();
    query = {
      select: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([{ id: '507f1f77bcf86cd799439013' }]),
      }),
      and: vi.fn().mockImplementation(function () {
        return this;
      }),
    };
  }

  // Create Page model mock (the only model still fetched via mongoose.model
  // -- Attachment reads now go through crowi.prisma.attachments, mocked below)
  const createPageModel = () => ({
    findByPathAndViewer: vi.fn().mockResolvedValue({
      _id: '507f1f77bcf86cd799439013',
      path: '/test-page',
    }),
    isAccessiblePageByViewer: vi.fn().mockResolvedValue(true),
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([{ id: '507f1f77bcf86cd799439013' }]),
      }),
      and: vi.fn().mockReturnThis(),
    }),
    addConditionToFilteringByViewerForList: vi.fn(),
    PageQueryBuilder: MockPageQueryBuilder,
  });

  return {
    ...actual,
    default: {
      ...actual.default,
      model: createPageModel,
    },
    model: createPageModel,
    Types: actual.Types,
  };
});

// Mock @growi/core modules
vi.mock('@growi/core', () => ({
  SCOPE: {
    READ: { FEATURES: { PAGE: 'read:page' } },
  },
}));

vi.mock('@growi/core/dist/models/serializers', () => ({
  serializeAttachmentSecurely: vi
    .fn()
    .mockImplementation((attachment) => attachment),
}));

vi.mock('@growi/core/dist/remark-plugins', () => ({
  OptionParser: {
    parseRange: vi.fn().mockReturnValue({ start: 1, end: 3 }),
  },
}));

// Mock FilterXSS
vi.mock('xss', () => ({
  FilterXSS: vi.fn().mockImplementation(() => ({
    process: vi.fn().mockImplementation((input) => input),
  })),
}));

const TEST_PORT = 3002;
const TEST_SERVER_URL = `http://localhost:${TEST_PORT}`;

describe('useSWRxRef and useSWRxRefs integration tests', () => {
  let server: Server;
  let app: express.Application;

  const setupAxiosSpy = () => {
    const originalAxios = axios.create();
    return vi.spyOn(axios, 'get').mockImplementation((url, config) => {
      const fullUrl = url.startsWith('/_api')
        ? `${TEST_SERVER_URL}${url}`
        : url;
      return originalAxios.get(fullUrl, config);
    });
  };

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS',
      );
      res.header(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Authorization',
      );
      next();
    });

    const mockCrowi = {
      loginRequiredFactory: () => (req: any, res: any, next: any) => next(),
      accessTokenParser: () => (req: any, res: any, next: any) => {
        req.user = { _id: '507f1f77bcf86cd799439012', username: 'testuser' };
        next();
      },
      prisma: {
        attachments: {
          findFirst: mockFindFirstAttachment,
          findMany: mockFindManyAttachments,
        },
      },
    };

    refsMiddleware(mockCrowi, app);

    return await new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useSWRxRef', () => {
    it('should make actual server request and receive attachment data for single ref request', async () => {
      const axiosGetSpy = setupAxiosSpy();

      const { result } = renderHook(() =>
        useSWRxRef('/test-page', 'test-image.jpg', false),
      );

      await waitFor(() => expect(result.current.data).toBeDefined(), {
        timeout: 5000,
      });

      expect(axiosGetSpy).toHaveBeenCalledWith(
        '/_api/attachment-refs/ref',
        expect.objectContaining({
          params: expect.objectContaining({
            pagePath: '/test-page',
            fileNameOrId: 'test-image.jpg',
          }),
        }),
      );

      expect(result.current.data).toBeDefined();
      expect(result.current.error).toBeUndefined();

      axiosGetSpy.mockRestore();
    });
  });

  describe('useSWRxRefs', () => {
    it('should make actual server request and receive attachments data for refs request with pagePath', async () => {
      const axiosGetSpy = setupAxiosSpy();

      const { result } = renderHook(() =>
        useSWRxRefs('/test-page', undefined, {}, false),
      );

      await waitFor(
        () => {
          expect(result.current.data).toBeDefined();
        },
        {
          timeout: 5000,
        },
      );

      expect(axiosGetSpy).toHaveBeenCalledWith(
        '/_api/attachment-refs/refs',
        expect.objectContaining({
          params: expect.objectContaining({
            pagePath: '/test-page',
            prefix: undefined,
            options: {},
          }),
        }),
      );

      expect(result.current.data).toBeDefined();
      expect(result.current.error).toBeUndefined();

      axiosGetSpy.mockRestore();
    });

    it('should make actual server request and receive attachments data for refs request with prefix', async () => {
      const axiosGetSpy = setupAxiosSpy();

      const { result } = renderHook(() =>
        useSWRxRefs('', '/test-prefix', { depth: '2' }, false),
      );

      await waitFor(
        () => {
          expect(result.current.data).toBeDefined();
        },
        {
          timeout: 5000,
        },
      );

      expect(axiosGetSpy).toHaveBeenCalledWith(
        '/_api/attachment-refs/refs',
        expect.objectContaining({
          params: expect.objectContaining({
            pagePath: '',
            prefix: '/test-prefix',
            options: { depth: '2' },
          }),
        }),
      );

      expect(result.current.data).toBeDefined();
      expect(result.current.error).toBeUndefined();

      axiosGetSpy.mockRestore();
    });
  });
});
