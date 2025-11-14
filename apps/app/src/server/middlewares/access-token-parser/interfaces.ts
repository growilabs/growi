import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';
import type { Request } from 'express';

type ReqQuery = {
  access_token?: string;
};
type ReqBody = {
  access_token?: string;
};

export interface AccessTokenParserReq
  extends Request<undefined, undefined, ReqBody, ReqQuery> {
  user?: IUserSerializedSecurely<IUserHasId>;
}
