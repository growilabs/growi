import {
  type IAttachmentLegacyShape,
  toLegacyAttachmentShape,
} from './attachment-serializer.js';

type AttachmentRow = Parameters<typeof toLegacyAttachmentShape>[0];

type BulkExportJobRow = {
  userId: string;
  attachmentId: string | null;
  attachment: AttachmentRow | null;
};

export type IBulkExportJobLegacyShape<J extends BulkExportJobRow> = Omit<
  J,
  'attachment'
> & {
  user: J['userId'];
  attachment:
    | IAttachmentLegacyShape<NonNullable<J['attachment']>>
    | J['attachmentId'];
};

/**
 * Restore the Mongoose-era field names on a Prisma bulk export job row.
 * `attachment` is the populated attachment when the query included it, and the
 * bare `attachmentId` otherwise.
 */
export const toLegacyBulkExportJobShape = <J extends BulkExportJobRow>(
  job: J,
): IBulkExportJobLegacyShape<J> => {
  const { attachment, ...rest } = job;

  return {
    ...rest,
    user: job.userId,
    attachment:
      attachment != null
        ? toLegacyAttachmentShape(attachment)
        : job.attachmentId,
  } as IBulkExportJobLegacyShape<J>;
};
