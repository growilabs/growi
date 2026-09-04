/**
 * Unit tests for embedAttachmentImages.
 *
 * Observable contract verified here:
 *  - Attachment `<img>` sources are only rewritten when the exporting user
 *    can access the page the attachment belongs to (permission bypass fix).
 *  - A stream error while downloading an attachment does not leave a
 *    truncated asset file behind that a later reference would treat as
 *    "already downloaded".
 *  - Non-RELAY response modes and html with no attachment references are
 *    left untouched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IUser } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { ResponseMode } from '~/server/interfaces/attachment';
import {
  Attachment,
  type IAttachmentDocument,
} from '~/server/models/attachment';
import { isAttachmentAccessibleToViewer } from '~/server/service/attachment/resolve-accessible-attachment';
import type { FileUploader } from '~/server/service/file-uploader/file-uploader';

import { embedAttachmentImages } from './embed-images';

vi.mock('~/server/models/attachment', () => ({
  Attachment: { find: vi.fn() },
}));

vi.mock('~/server/service/attachment/resolve-accessible-attachment', () => ({
  isAttachmentAccessibleToViewer: vi.fn(),
}));

describe('embedAttachmentImages', () => {
  const attachmentId = '000000000000000000000001';
  const exportingUser = mock<HydratedDocument<IUser>>();
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'embed-images-spec-'),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const buildCrowi = (fileUploadService: FileUploader): Crowi =>
    mock<Crowi>({ fileUploadService });

  const htmlWithAttachment = (id: string) =>
    `<p><img src="/attachment/${id}" alt=""></p>`;

  it('returns the html unchanged when it has no attachment image references', async () => {
    const html = '<p>no images here</p>';
    const crowi = buildCrowi(mock<FileUploader>());

    const result = await embedAttachmentImages(html, {
      fileOutputPath: path.join(outputDir, 'page.html'),
      outputDir,
      crowi,
      exportingUser,
    });

    expect(result).toBe(html);
    expect(Attachment.find).not.toHaveBeenCalled();
  });

  it('leaves the html unchanged for non-RELAY response modes', async () => {
    const fileUploadService = mock<FileUploader>({
      determineResponseMode: vi.fn().mockReturnValue(ResponseMode.REDIRECT),
    });
    const crowi = buildCrowi(fileUploadService);
    const html = htmlWithAttachment(attachmentId);

    const result = await embedAttachmentImages(html, {
      fileOutputPath: path.join(outputDir, 'page.html'),
      outputDir,
      crowi,
      exportingUser,
    });

    expect(result).toBe(html);
    expect(Attachment.find).not.toHaveBeenCalled();
  });

  it('does not embed an attachment the exporting user cannot access', async () => {
    const attachment = mock<IAttachmentDocument>({
      _id: attachmentId,
      fileName: 'secret.png',
      page: '000000000000000000000099',
    });
    vi.mocked(Attachment.find).mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(false);
    const findDeliveryFile = vi.fn();
    const fileUploadService = mock<FileUploader>({
      determineResponseMode: vi.fn().mockReturnValue(ResponseMode.RELAY),
      findDeliveryFile,
    });
    const crowi = buildCrowi(fileUploadService);
    const html = htmlWithAttachment(attachmentId);

    const result = await embedAttachmentImages(html, {
      fileOutputPath: path.join(outputDir, 'page.html'),
      outputDir,
      crowi,
      exportingUser,
    });

    expect(result).toBe(html);
    expect(findDeliveryFile).not.toHaveBeenCalled();
    expect(isAttachmentAccessibleToViewer).toHaveBeenCalledWith(
      attachment,
      exportingUser,
      false,
    );
  });

  it('downloads and rewrites the src for an accessible attachment', async () => {
    const attachment = mock<IAttachmentDocument>({
      _id: attachmentId,
      fileName: 'photo.png',
      page: '000000000000000000000099',
    });
    vi.mocked(Attachment.find).mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);
    const fileUploadService = mock<FileUploader>({
      determineResponseMode: vi.fn().mockReturnValue(ResponseMode.RELAY),
      findDeliveryFile: vi
        .fn()
        .mockResolvedValue(Readable.from(Buffer.from('binary-image-data'))),
    });
    const crowi = buildCrowi(fileUploadService);
    const fileOutputPath = path.join(outputDir, 'page.html');

    const result = await embedAttachmentImages(
      htmlWithAttachment(attachmentId),
      { fileOutputPath, outputDir, crowi, exportingUser },
    );

    expect(result).not.toContain(`/attachment/${attachmentId}`);
    expect(Attachment.find).toHaveBeenCalledWith({
      _id: { $in: [attachmentId] },
    });
    const assetFilePath = path.join(
      outputDir,
      '_bulk-export-assets',
      `${attachmentId}.png`,
    );
    await expect(fs.promises.readFile(assetFilePath, 'utf-8')).resolves.toBe(
      'binary-image-data',
    );
  });

  it('does not leave a truncated asset file behind when the download stream errors', async () => {
    const attachment = mock<IAttachmentDocument>({
      _id: attachmentId,
      fileName: 'photo.png',
      page: '000000000000000000000099',
    });
    vi.mocked(Attachment.find).mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);

    const failingReadable = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    const fileUploadService = mock<FileUploader>({
      determineResponseMode: vi.fn().mockReturnValue(ResponseMode.RELAY),
      findDeliveryFile: vi.fn().mockResolvedValue(failingReadable),
    });
    const crowi = buildCrowi(fileUploadService);
    const html = htmlWithAttachment(attachmentId);

    const result = await embedAttachmentImages(html, {
      fileOutputPath: path.join(outputDir, 'page.html'),
      outputDir,
      crowi,
      exportingUser,
    });

    // The failure is caught and logged; the src is left untouched (best effort).
    expect(result).toBe(html);
    const assetFilePath = path.join(
      outputDir,
      '_bulk-export-assets',
      `${attachmentId}.png`,
    );
    expect(fs.existsSync(assetFilePath)).toBe(false);
  });
});
