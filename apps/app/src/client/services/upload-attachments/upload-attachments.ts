import type { IAttachment } from '@growi/core';

import { apiv3Get, apiv3PostForm } from '~/client/util/apiv3-client';
import type {
  IApiv3GetAttachmentLimitParams,
  IApiv3GetAttachmentLimitResponse,
  IApiv3PostAttachmentResponse,
} from '~/interfaces/apiv3/attachment';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:client:services:upload-attachment');

type UploadOpts = {
  onUploaded?: (attachment: IAttachment) => void;
  onError?: (error: Error, file: File) => void;
};

export const uploadAttachments = async (
  pageId: string,
  files: File[],
  opts?: UploadOpts,
): Promise<void> => {
  files.forEach(async (file) => {
    try {
      const params: IApiv3GetAttachmentLimitParams = { fileSize: file.size };
      const { data: resLimit } =
        await apiv3Get<IApiv3GetAttachmentLimitResponse>(
          '/attachment/limit',
          params,
        );

      if (!resLimit.isUploadable) {
        throw new Error(resLimit.errorMessage);
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('page_id', pageId);

      const { data: resAdd } =
        await apiv3PostForm<IApiv3PostAttachmentResponse>(
          '/attachment',
          formData,
        );

      opts?.onUploaded?.(resAdd.attachment);
    } catch (e) {
      logger.error('failed to upload', e);
      opts?.onError?.(e, file);
    }
  });
};
