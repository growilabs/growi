import type { IPageHasId } from '@growi/core';
import type { NextFunction, Response, RequestHandler } from 'express';
import mongoose from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';

interface GrowiInjectedResponse {
  apiv3Err: (errors: string | Error | any[], status?: number, code?: string) => Response;
}

type TypedResponse = Response & GrowiInjectedResponse;

export const blockUserPagesMiddlewareFactory = (crowi: Crowi): RequestHandler => {
  const userPagePattern = /^\/user(\/.*)?$/;

  return async(req: CrowiRequest, res: TypedResponse, next: NextFunction): Promise<void | Response> => {
    const { user } = req;

    const hideUserPages = crowi.configManager.getConfig('security:isHidingUserPages');
    if (!hideUserPages || user?.admin) {
      return next();
    }

    const pathToCheck = (req.query.path as string) || req.path;
    const pageId = req.query.pageId as string | undefined;
    let finalPath: string | undefined = pathToCheck;

    if (finalPath && !userPagePattern.test(finalPath)) {
      return next();
    }

    if (!finalPath && pageId) {
      const Page = mongoose.model<IPageHasId>('Page');
      const page = await Page.findById(pageId).select('path').exec();
      finalPath = page?.path;
    }

    if (finalPath && userPagePattern.test(finalPath)) {
      const isOwnPage = user != null && (
        finalPath === `/user/${user.username}`
        || finalPath.startsWith(`/user/${user.username}/`)
      );

      if (!isOwnPage) {

        if (req.originalUrl.includes('/_api/')) {
          return res.apiv3Err('Page is not found', 404);
        }

        res.status(404);
        req.url = `/404_${Math.random().toString(36).substring(7)}`;

        return next();
      }
    }

    next();
  };
};
