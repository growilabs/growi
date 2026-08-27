import type { IUser } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { Attachment, type IAttachmentDocument } from '../../models/attachment';
import { resolveAccessibleAttachment } from './resolve-accessible-attachment';

vi.mock('../../models/attachment', () => ({
  Attachment: { findById: vi.fn() },
}));

describe('resolveAccessibleAttachment', () => {
  const pageId = '000000000000000000000001';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildAttachment = (hasPage: boolean): IAttachmentDocument =>
    mock<IAttachmentDocument>({
      id: 'attachment1',
      page: hasPage ? pageId : undefined,
    });

  const mockIsAccessiblePageByViewer = (isAccessible: boolean) => {
    const isAccessiblePageByViewer = vi.fn().mockResolvedValue(isAccessible);
    vi.spyOn(mongoose, 'model').mockReturnValue({
      isAccessiblePageByViewer,
    } as unknown as ReturnType<typeof mongoose.model>);
    return isAccessiblePageByViewer;
  };

  it('reports not_found when no attachment exists for the id', async () => {
    vi.mocked(Attachment.findById).mockResolvedValue(null);

    const result = await resolveAccessibleAttachment(
      'missing',
      undefined,
      false,
    );

    expect(result).toEqual({ errorCode: 'not_found' });
  });

  it('reports forbidden when the viewer cannot access the owning page', async () => {
    vi.mocked(Attachment.findById).mockResolvedValue(buildAttachment(true));
    const isAccessiblePageByViewer = mockIsAccessiblePageByViewer(false);
    const user = mock<HydratedDocument<IUser>>();

    const result = await resolveAccessibleAttachment(
      'attachment1',
      user,
      false,
    );

    expect(isAccessiblePageByViewer).toHaveBeenCalledWith(pageId, user);
    expect(result).toEqual({ errorCode: 'forbidden' });
  });

  it('returns the attachment when the viewer can access the owning page', async () => {
    const attachment = buildAttachment(true);
    vi.mocked(Attachment.findById).mockResolvedValue(attachment);
    mockIsAccessiblePageByViewer(true);

    const result = await resolveAccessibleAttachment(
      'attachment1',
      mock<HydratedDocument<IUser>>(),
      false,
    );

    expect(result).toEqual({ attachment });
  });

  it('skips the viewer check for an attachment with no owning page', async () => {
    const attachment = buildAttachment(false);
    vi.mocked(Attachment.findById).mockResolvedValue(attachment);
    const modelSpy = vi.spyOn(mongoose, 'model');

    const result = await resolveAccessibleAttachment(
      'attachment1',
      undefined,
      false,
    );

    expect(modelSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ attachment });
  });

  it('skips the viewer check when the request is via a certified share link', async () => {
    const attachment = buildAttachment(true);
    vi.mocked(Attachment.findById).mockResolvedValue(attachment);
    const isAccessiblePageByViewer = mockIsAccessiblePageByViewer(false);

    const result = await resolveAccessibleAttachment(
      'attachment1',
      undefined,
      true,
    );

    expect(isAccessiblePageByViewer).not.toHaveBeenCalled();
    expect(result).toEqual({ attachment });
  });

  it('populates the requested field in a single query when populate is given', async () => {
    const attachment = buildAttachment(false);
    const populate = vi.fn().mockResolvedValue(attachment);
    vi.mocked(Attachment.findById).mockReturnValue({
      populate,
    } as unknown as ReturnType<typeof Attachment.findById>);

    const result = await resolveAccessibleAttachment(
      'attachment1',
      undefined,
      false,
      'creator',
    );

    expect(populate).toHaveBeenCalledWith('creator');
    expect(result).toEqual({ attachment });
  });
});
