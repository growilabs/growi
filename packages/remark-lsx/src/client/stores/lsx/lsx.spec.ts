// tests for assuring axios request succeeds in version change

import type { Server } from 'node:http';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import express from 'express';
import lsxMiddleware from '../../../server';

import { useSWRxLsx } from './lsx';

// Mock the generateBaseQuery function
vi.mock('../../../server/routes/list-pages/generate-base-query', () => ({
  generateBaseQuery: vi.fn().mockResolvedValue({
    query: {
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      clone: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(10),
      exec: vi.fn().mockResolvedValue([]),
    },
    addConditionToListOnlyDescendants: vi.fn().mockReturnThis(),
    addConditionToFilteringByViewerForList: vi.fn().mockReturnThis(),
  }),
}));

// Mock mongoose model
vi.mock('mongoose', () => ({
  model: vi.fn().mockReturnValue({
    find: vi.fn().mockReturnValue({
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      clone: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(10),
      exec: vi.fn().mockResolvedValue([]),
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([{ count: 5 }]),
  }),
}));

const TEST_PORT = 3001;
const TEST_SERVER_URL = `http://localhost:${TEST_PORT}`;

describe('useSWRxLsx integration tests', () => {
  let server: Server;
  let app: express.Application;

  // Helper function to setup axios spy
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
    // Create minimal Express app with just the LSX route
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Add CORS headers to prevent cross-origin issues
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

    // Mock minimal GROWI-like structure for the middleware
    const mockCrowi = {
      require: () => () => (req: any, res: any, next: any) => next(),
      accessTokenParser: () => (req: any, res: any, next: any) => next(),
    };

    // Import and setup the LSX middleware
    lsxMiddleware(mockCrowi, app);

    // Start test server
    return new Promise<void>((resolve) => {
      server = app.listen(TEST_PORT, () => {
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      if (server) {
        server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  it('should make actual server request and receive 2xx response for basic lsx request', async () => {
    const axiosGetSpy = setupAxiosSpy();

    const { result } = renderHook(() =>
      useSWRxLsx('/test-page', { depth: '1' }, false),
    );

    await waitFor(() => expect(result.current.data).toBeDefined(), {
      timeout: 5000,
    });

    expect(axiosGetSpy).toHaveBeenCalledWith(
      '/_api/lsx',
      expect.objectContaining({
        params: expect.objectContaining({
          pagePath: '/test-page',
          options: expect.objectContaining({ depth: '1' }),
        }),
      }),
    );

    expect(result.current.data).toBeDefined();
    expect(result.current.error).toBeUndefined();

    axiosGetSpy.mockRestore();
  });

  it('should handle server validation errors properly', async () => {
    const axiosGetSpy = setupAxiosSpy();

    const { result } = renderHook(() => useSWRxLsx('', {}, false));

    await waitFor(() => expect(result.current.error).toBeDefined(), {
      timeout: 5000,
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();

    axiosGetSpy.mockRestore();
  });
});
