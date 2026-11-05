/**
 * Unit tests for embedAttachmentImages.
 *
 * Observable contract verified here:
 *  - Attachment `<img>` sources are only rewritten when the exporting user
 *    can access the page the attachment belongs to (permission bypass fix).
 *  - A stream error while downloading an attachment does not leave a
 *    truncated asset file behind that a later reference would treat as
 *    "already downloaded".
 *  - Attachments are embedded regardless of the storage's response mode
 *    (RELAY / REDIRECT / DELEGATE only govern how the HTTP route answers a
 *    browser, not whether the server can read the file).
 *  - Html with no attachment references is left untouched.
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
import type { AttachmentWithComputed } from '~/server/models/attachment';
import { isAttachmentAccessibleToViewer } from '~/server/service/attachment/resolve-accessible-attachment';
import type { FileUploader } from '~/server/service/file-uploader/file-uploader';
import { prisma } from '~/utils/prisma';

import { embedAttachmentImages } from './embed-images';

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
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([]);
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
    expect(prisma.attachments.findMany).not.toHaveBeenCalled();
  });

  it.each(
    Object.values(ResponseMode),
  )('embeds an accessible attachment when the response mode is %s', async (responseMode) => {
    const attachment = mock<AttachmentWithComputed>({
      id: attachmentId,
      fileName: 'photo.png',
      pageId: '000000000000000000000099',
    });
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);
    const fileUploadService = mock<FileUploader>({
      determineResponseMode: vi.fn().mockReturnValue(responseMode),
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

    expect(result).toBe(
      `<p><img src="_bulk-export-assets/${attachmentId}.png" alt=""></p>`,
    );
    const assetFilePath = path.join(
      outputDir,
      '_bulk-export-assets',
      `${attachmentId}.png`,
    );
    await expect(fs.promises.readFile(assetFilePath, 'utf-8')).resolves.toBe(
      'binary-image-data',
    );
  });

  it('does not embed an attachment the exporting user cannot access', async () => {
    const attachment = mock<AttachmentWithComputed>({
      id: attachmentId,
      fileName: 'secret.png',
      pageId: '000000000000000000000099',
    });
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(false);
    const findDeliveryFile = vi.fn();
    const fileUploadService = mock<FileUploader>({
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

  it('does not leave a truncated asset file behind when the download stream errors', async () => {
    const attachment = mock<AttachmentWithComputed>({
      id: attachmentId,
      fileName: 'photo.png',
      pageId: '000000000000000000000099',
    });
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);

    const failingReadable = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    const fileUploadService = mock<FileUploader>({
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
