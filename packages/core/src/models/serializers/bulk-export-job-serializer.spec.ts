import ObjectId from 'bson-objectid';

import { toLegacyBulkExportJobShape } from './bulk-export-job-serializer.js';

describe('toLegacyBulkExportJobShape', () => {
  const baseJob = {
    id: new ObjectId().toString(),
    userId: new ObjectId().toString(),
  };

  it('sets user to userId', () => {
    const job = { ...baseJob, attachmentId: null, attachment: null };

    expect(toLegacyBulkExportJobShape(job)).toStrictEqual({
      id: job.id,
      userId: job.userId,
      attachmentId: null,
      user: job.userId,
      attachment: null,
    });
  });

  it('sets attachment to attachmentId when the attachment is not included', () => {
    const attachmentId = new ObjectId().toString();
    const job = { ...baseJob, attachmentId, attachment: null };

    expect(toLegacyBulkExportJobShape(job).attachment).toBe(attachmentId);
  });

  it('converts the included attachment to the legacy shape', () => {
    const attachment = {
      id: new ObjectId().toString(),
      pageId: new ObjectId().toString(),
      creatorId: new ObjectId().toString(),
    };
    const job = { ...baseJob, attachmentId: attachment.id, attachment };

    expect(toLegacyBulkExportJobShape(job).attachment).toStrictEqual({
      ...attachment,
      page: attachment.pageId,
      creator: attachment.creatorId,
    });
  });
});
