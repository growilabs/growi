import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';

type AuthenticatedRequest = Request & {
  user?: { _id: Types.ObjectId; readOnly: boolean };
};

const authenticatedMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (req.user == null) {
    return res.sendStatus(403);
  }
  return next();
};

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => authenticatedMiddleware,
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => authenticatedMiddleware,
}));

vi.mock('~/server/service/page/find-page-and-meta-data-by-viewer', () => ({
  findPageAndMetaDataByViewer: vi.fn(),
}));

describe('PUT /rename', () => {
  const pageId = '507f1f77bcf86cd799439011';
  const user = { _id: new Types.ObjectId(), readOnly: false };

  const pageExists = vi.fn();
  const renamePage = vi.fn();
  const fireGlobalNotification = vi.fn();

  const mockedFindPageAndMetaDataByViewer = vi.mocked(
    findPageAndMetaDataByViewer,
  );

  let app: express.Application;
  let crowi: Crowi;

  beforeAll(async () => {
    crowi = mock<Crowi>({
      models: {
        Page: { exists: pageExists } as unknown as Crowi['models']['Page'],
        User: {} as Crowi['models']['User'],
      },
      events: {
        activity: { emit: vi.fn() },
      },
      globalNotificationService: {
        fire: fireGlobalNotification,
      },
      pageService: {
        renamePage,
      },
      pageGrantService: mock<Crowi['pageGrantService']>(),
    });

    addCustomFunctionToResponse(express);

    app = express();
    app.use(express.json());
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.user = user;
      next();
    });

    const pagesModule = (await import('./index')) as unknown as {
      setup: (crowi: Crowi) => express.Router;
    };
    app.use('/', pagesModule.setup(crowi));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    pageExists.mockResolvedValue(null);
    fireGlobalNotification.mockResolvedValue(undefined);
  });

  it('returns page-not-found for an authenticated request with a valid missing page ID', async () => {
    mockedFindPageAndMetaDataByViewer.mockResolvedValueOnce({
      data: null,
      meta: {
        isNotFound: true,
        isForbidden: false,
      },
    } as never);

    const response = await request(app).put('/rename').send({
      pageId,
      newPagePath: '/renamed-page',
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      errors: [
        {
          code: 'page-not-found',
          args: {
            isNotFound: true,
            isForbidden: false,
          },
          message: 'Page is not found',
        },
      ],
    });
    expect(renamePage).not.toHaveBeenCalled();
    expect(mockedFindPageAndMetaDataByViewer).toHaveBeenCalledWith(
      crowi.pageService,
      crowi.pageGrantService,
      {
        pageId,
        path: null,
        user,
        basicOnly: true,
      },
    );
  });

  it('returns page-is-forbidden for an authenticated request without page access', async () => {
    mockedFindPageAndMetaDataByViewer.mockResolvedValueOnce({
      data: null,
      meta: {
        isNotFound: true,
        isForbidden: true,
      },
    } as never);

    const response = await request(app).put('/rename').send({
      pageId,
      newPagePath: '/renamed-page',
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      errors: [
        {
          code: 'page-is-forbidden',
          args: {
            isNotFound: true,
            isForbidden: true,
          },
          message: 'Page is forbidden',
        },
      ],
    });
    expect(renamePage).not.toHaveBeenCalled();
  });

  it('continues to rename an accessible page', async () => {
    const page = {
      _id: pageId,
      path: '/source-page',
      descendantCount: 1,
      isEmpty: true,
    };
    const renamedPage = {
      ...page,
      path: '/renamed-page',
    };

    mockedFindPageAndMetaDataByViewer.mockResolvedValueOnce({
      data: page,
      meta: {
        isNotFound: false,
      },
    } as never);
    renamePage.mockResolvedValueOnce(renamedPage);

    const response = await request(app).put('/rename').send({
      pageId,
      newPagePath: '/renamed-page',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ page: renamedPage });
    expect(renamePage).toHaveBeenCalledWith(
      page,
      '/renamed-page',
      user,
      expect.objectContaining({ isRecursively: true }),
      expect.objectContaining({ endpoint: '/rename' }),
    );
  });
});
