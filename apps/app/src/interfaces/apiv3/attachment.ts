import type { IAttachment, IPage, IRevision } from '@growi/core';

import type { ICheckLimitResult } from '../attachment';

export type IApiv3GetAttachmentLimitParams = {
  fileSize: number;
};

export type IApiv3GetAttachmentLimitResponse = ICheckLimitResult;

export type IApiv3PostAttachmentResponse = {
  page: IPage;
  revision: IRevision;
  attachment: IAttachment;
};
