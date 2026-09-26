import { mock } from 'vitest-mock-extended';

import { prisma } from '~/utils/prisma';

import type Crowi from '../crowi';
import { AttachmentService } from './attachment';

// Locks down two contracts of removeAttachment:
// 1. Missing metadata doc is a no-op (the bulk-export cleanup cron relies on
//    this to self-heal zombie job records without throwing).
// 2. A genuine file-store failure propagates, so callers like the attachment
//    delete API surface it instead of dropping the metadata doc and stranding
//    an orphan blob.
describe('AttachmentService.removeAttachment', () => {
  test('should resolve without throwing when the attachment is already gone', async () => {
    const findUniqueSpy = vi
      .spyOn(prisma.attachments, 'findUnique')
      .mockResolvedValueOnce(null);
    const deleteFile = vi.fn();
    const crowi = mock<Crowi>({
      fileUploadService: { deleteFile },
    });
    const service = new AttachmentService(crowi);

    await expect(
      service.removeAttachment('this-id-does-not-exist'),
    ).resolves.toBeUndefined();

    expect(deleteFile).not.toHaveBeenCalled();
    findUniqueSpy.mockRestore();
  });

  test('should propagate the error and not drop the metadata doc when the file store fails', async () => {
    const deleteSpy = vi.spyOn(prisma.attachments, 'delete');
    const fakeAttachment = mock<
      Awaited<ReturnType<typeof prisma.attachments.findUnique>>
    >({
      id: 'some-id',
    });
    const findUniqueSpy = vi
      .spyOn(prisma.attachments, 'findUnique')
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
    expect(deleteSpy).not.toHaveBeenCalled();
    findUniqueSpy.mockRestore();
  });
});
