import type { IAttachmentHasId } from '@growi/core/dist/interfaces';

import type { PaginateResult } from './mongoose-utils';

export const AttachmentMethodType = {
  aws: 'aws',
  gcs: 'gcs',
  gcp: 'gcp',
  azure: 'azure',
  gridfs: 'gridfs',
  mongo: 'mongo',
  mongodb: 'mongodb',
  local: 'local',
  none: 'none',
} as const;
export type AttachmentMethodType =
  (typeof AttachmentMethodType)[keyof typeof AttachmentMethodType];

export type IResAttachmentList = {
  paginateResult: PaginateResult<IAttachmentHasId>;
};

export type ICheckLimitResult = {
  isUploadable: boolean;
  errorMessage?: string;
};
