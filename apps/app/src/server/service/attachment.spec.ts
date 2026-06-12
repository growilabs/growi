import { mock } from 'vitest-mock-extended';

import type Crowi from '../crowi';
import type { IAttachmentDocument } from '../models/attachment';
import { Attachment } from '../models/attachment';
import { AttachmentService } from './attachment';

// Locks down two contracts of removeAttachment:
// 1. Missing metadata doc is a no-op (the bulk-export cleanup cron relies on
//    this to self-heal zombie job records without throwing).
// 2. A genuine file-store failure propagates, so callers like the attachment
//    delete API surface it instead of dropping the metadata doc and stranding
//    an orphan blob.
describe('AttachmentService.removeAttachment', () => {
  test('should resolve without throwing when the attachment is already gone', async () => {
    const findByIdSpy = vi
      .spyOn(Attachment, 'findById')
      .mockResolvedValue(null);
    const deleteFile = vi.fn();
    const crowi = mock<Crowi>({
      fileUploadService: { deleteFile },
    });
    const service = new AttachmentService(crowi);

    await expect(
      service.removeAttachment('this-id-does-not-exist'),
    ).resolves.toBeUndefined();

    expect(deleteFile).not.toHaveBeenCalled();
    findByIdSpy.mockRestore();
  });

  test('should propagate the error and not drop the metadata doc when the file store fails', async () => {
    const attachmentRemove = vi.fn().mockResolvedValue(undefined);
    const fakeAttachment = mock<IAttachmentDocument>({
      remove: attachmentRemove,
    });
    const findByIdSpy = vi
      .spyOn(Attachment, 'findById')
      .mockResolvedValue(fakeAttachment);
    const deleteFile = vi
      .fn()
      .mockRejectedValue(new Error('S3 is temporarily unavailable'));
    const crowi = mock<Crowi>({
      fileUploadService: { deleteFile },
    });
    const service = new AttachmentService(crowi);
    service.detachHandlers = [];

    await expect(service.removeAttachment('some-id')).rejects.toThrow(
      'S3 is temporarily unavailable',
    );

    expect(deleteFile).toHaveBeenCalledTimes(1);
    // metadata doc must survive so the blob stays referenceable for retry
    expect(attachmentRemove).not.toHaveBeenCalled();
    findByIdSpy.mockRestore();
  });
});
