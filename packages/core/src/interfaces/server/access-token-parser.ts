import type { Request, RequestHandler } from 'express';

import type { IUserSerializedSecurely } from '../../models/serializers/index.js';
import type { Scope } from '../scope.js';
import type { IUserHasId } from '../user.js';

export interface AccessTokenParserReq extends Request {
  user?: IUserSerializedSecurely<IUserHasId>;
  query: Request['query'] & {
    access_token?: string;
  };
  body: Request['body'] & {
    access_token?: string;
  };
}

export type AccessTokenParser = (
  scopes?: Scope[],
  opts?: { acceptLegacy: boolean },
) => RequestHandler;
