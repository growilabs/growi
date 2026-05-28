import type Crowi from '../crowi';
import { Attachment } from '../models/attachment';
import { AttachmentService } from './attachment';

// Locks down the idempotent contract that the bulk-export cleanup cron relies
// on (page-bulk-export-job-clean-up-cron.ts): removing an attachment whose
// metadata doc is already gone must resolve without throwing, otherwise the
// surrounding Promise.allSettled rejects the cleanup and leaves the parent job
// record undeleted as a zombie.
describe('AttachmentService.removeAttachment', () => {
  test('should resolve without throwing when the attachment is already gone', async () => {
    const findByIdSpy = vi
      .spyOn(Attachment, 'findById')
      // biome-ignore lint/suspicious/noExplicitAny: Mongoose query shape is irrelevant to the contract under test
      .mockResolvedValue(null as any);
    const deleteFile = vi.fn();
    const crowi = {
      fileUploadService: { deleteFile },
    } as unknown as Crowi;
    const service = new AttachmentService(crowi);

    await expect(
      service.removeAttachment('this-id-does-not-exist'),
    ).resolves.toBeUndefined();

    expect(deleteFile).not.toHaveBeenCalled();
    findByIdSpy.mockRestore();
  });

  test('should still drop the metadata doc when the underlying file delete throws (race with concurrent remover)', async () => {
    const attachmentRemove = vi.fn().mockResolvedValue(undefined);
    const fakeAttachment = { _id: 'some-id', remove: attachmentRemove };
    const findByIdSpy = vi
      .spyOn(Attachment, 'findById')
      // biome-ignore lint/suspicious/noExplicitAny: Mongoose query shape is irrelevant to the contract under test
      .mockResolvedValue(fakeAttachment as any);
    const deleteFile = vi
      .fn()
      .mockRejectedValue(new Error('File not found for id some-id'));
    const crowi = {
      fileUploadService: { deleteFile },
      detachHandlers: [],
    } as unknown as Crowi;
    const service = new AttachmentService(crowi);
    // detachHandlers lives on the service instance, not crowi
    service.detachHandlers = [];

    await expect(service.removeAttachment('some-id')).resolves.toBeUndefined();

    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(attachmentRemove).toHaveBeenCalledTimes(1);
    findByIdSpy.mockRestore();
  });
});
