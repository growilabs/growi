import type { IUser } from '@growi/core';
import type { Request } from 'express';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';

export interface CrowiProperties {
  user?: HydratedDocument<IUser>;

  crowi: Crowi;

  session: any;
}

export interface CrowiRequest extends CrowiProperties, Request {}
