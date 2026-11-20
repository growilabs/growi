/**
 * Unit tests for embedAttachmentImages.
 *
 * Observable contract verified here:
 *  - Attachment `<img>` sources are only rewritten when the exporting user
 *    can access the page the attachment belongs to (permission bypass fix).
 *  - Only attachments whose content type is an image are embedded, and the
 *    asset's file extension comes from that content type, never from the
 *    uploaded file name (pdf-converter converts every `*.html` it finds).
 *    The one exception is `application/octet-stream` (an upload whose type
 *    the client could not tell): it is embedded when the file name has an
 *    image extension, which then becomes the asset's extension.
 *  - A stream error while downloading an attachment does not leave a
 *    truncated asset file behind that a later reference would treat as
 *    "already downloaded".
 *  - Attachments are embedded regardless of the storage's response mode
 *    (RELAY / REDIRECT / DELEGATE only govern how the HTTP route answers a
 *    browser, not whether the server can read the file).
 *  - Each attachment is looked up in one batched query and downloaded once,
 *    one download at a time.
 *  - A download that fails, or does not finish within `downloadTimeoutMs`,
 *    leaves that image's src untouched and no file behind; the page still
 *    exports.
 *  - When the export job is cancelled (`signal` aborts), embedding stops:
 *    the call rejects with the abort reason instead of skipping the image,
 *    and no partial asset file is left behind.
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

  // `mock<T>()` turns every unset property into a stub function, so
  // `fileFormat` must always be set explicitly.
  const buildAttachment = (
    overrides: Partial<AttachmentWithComputed> = {},
  ): AttachmentWithComputed =>
    mock<AttachmentWithComputed>({
      id: attachmentId,
      fileName: 'photo.png',
      fileFormat: 'image/png',
      pageId: '000000000000000000000099',
      ...overrides,
    });

  const imageUploader = (overrides: Partial<FileUploader> = {}): FileUploader =>
    mock<FileUploader>({
      findDeliveryFile: vi
        .fn()
        .mockResolvedValue(Readable.from(Buffer.from('binary-image-data'))),
      ...overrides,
    });

  const htmlWithAttachment = (id: string) =>
    `<p><img src="/attachment/${id}" alt=""></p>`;

  const assetPath = (fileName: string) =>
    path.join(outputDir, '_bulk-export-assets', fileName);

  const embed = (
    html: string,
    fileUploadService: FileUploader,
    {
      downloadTimeoutMs = 10_000,
      signal = new AbortController().signal,
    }: { downloadTimeoutMs?: number; signal?: AbortSignal } = {},
  ) =>
    embedAttachmentImages(html, {
      fileOutputPath: path.join(outputDir, 'page.html'),
      outputDir,
      crowi: buildCrowi(fileUploadService),
      exportingUser,
      downloadTimeoutMs,
      signal,
    });

  it('returns the html unchanged when it has no attachment image references', async () => {
    const html = '<p>no images here</p>';

    const result = await embed(html, mock<FileUploader>());

    expect(result).toBe(html);
    expect(prisma.attachments.findMany).not.toHaveBeenCalled();
  });

  it.each(
    Object.values(ResponseMode),
  )('embeds an accessible attachment when the response mode is %s', async (responseMode) => {
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
      buildAttachment(),
    ]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);

    const result = await embed(
      htmlWithAttachment(attachmentId),
      imageUploader({
        determineResponseMode: vi.fn().mockReturnValue(responseMode),
      }),
    );

    expect(result).toBe(
      `<p><img src="_bulk-export-assets/${attachmentId}.png" alt=""></p>`,
    );
    await expect(
      fs.promises.readFile(assetPath(`${attachmentId}.png`), 'utf-8'),
    ).resolves.toBe('binary-image-data');
  });

  it('does not embed an attachment the exporting user cannot access', async () => {
    const attachment = buildAttachment({ fileName: 'secret.png' });
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([attachment]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(false);
    const findDeliveryFile = vi.fn();
    const html = htmlWithAttachment(attachmentId);

    const result = await embed(html, mock<FileUploader>({ findDeliveryFile }));

    expect(result).toBe(html);
    expect(findDeliveryFile).not.toHaveBeenCalled();
    expect(isAttachmentAccessibleToViewer).toHaveBeenCalledWith(
      attachment,
      exportingUser,
      false,
    );
  });

  describe('content type', () => {
    beforeEach(() => {
      vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);
    });

    it('does not download or embed an attachment that is not an image', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment({ fileName: 'page.html', fileFormat: 'text/html' }),
      ]);
      const findDeliveryFile = vi.fn();
      const html = htmlWithAttachment(attachmentId);

      const result = await embed(
        html,
        mock<FileUploader>({ findDeliveryFile }),
      );

      expect(result).toBe(html);
      expect(findDeliveryFile).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(outputDir, '_bulk-export-assets'))).toBe(
        false,
      );
    });

    it('takes the extension from the content type, not the uploaded file name', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment({ fileName: 'evil.html', fileFormat: 'image/png' }),
      ]);

      const result = await embed(
        htmlWithAttachment(attachmentId),
        imageUploader(),
      );

      expect(result).toBe(
        `<p><img src="_bulk-export-assets/${attachmentId}.png" alt=""></p>`,
      );
      expect(await fs.promises.readdir(assetPath(''))).toEqual([
        `${attachmentId}.png`,
      ]);
    });

    it('saves an image of an unlisted subtype without an extension', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment({ fileName: 'scan.jpg', fileFormat: 'image/pjpeg' }),
      ]);

      const result = await embed(
        htmlWithAttachment(attachmentId),
        imageUploader(),
      );

      expect(result).toBe(
        `<p><img src="_bulk-export-assets/${attachmentId}" alt=""></p>`,
      );
      await expect(
        fs.promises.readFile(assetPath(attachmentId), 'utf-8'),
      ).resolves.toBe('binary-image-data');
    });

    it('embeds an application/octet-stream upload whose file name has an image extension', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment({
          fileName: 'Screenshot.PNG',
          fileFormat: 'application/octet-stream',
        }),
      ]);

      const result = await embed(
        htmlWithAttachment(attachmentId),
        imageUploader(),
      );

      expect(result).toBe(
        `<p><img src="_bulk-export-assets/${attachmentId}.png" alt=""></p>`,
      );
      await expect(
        fs.promises.readFile(assetPath(`${attachmentId}.png`), 'utf-8'),
      ).resolves.toBe('binary-image-data');
    });

    it.each([
      'page.html',
      'archive.zip',
      'no-extension',
    ])('does not embed an application/octet-stream upload named %s', async (fileName) => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment({ fileName, fileFormat: 'application/octet-stream' }),
      ]);
      const findDeliveryFile = vi.fn();
      const html = htmlWithAttachment(attachmentId);

      const result = await embed(
        html,
        mock<FileUploader>({ findDeliveryFile }),
      );

      expect(result).toBe(html);
      expect(findDeliveryFile).not.toHaveBeenCalled();
    });
  });

  it('does not leave a truncated asset file behind when the download stream errors', async () => {
    vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
      buildAttachment(),
    ]);
    vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);
    const failingReadable = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    const html = htmlWithAttachment(attachmentId);

    const result = await embed(
      html,
      mock<FileUploader>({
        findDeliveryFile: vi.fn().mockResolvedValue(failingReadable),
      }),
    );

    // The failure is caught and logged; the src is left untouched (best effort).
    expect(result).toBe(html);
    expect(fs.existsSync(assetPath(`${attachmentId}.png`))).toBe(false);
  });

  describe('downloads', () => {
    const otherId = '000000000000000000000002';

    beforeEach(() => {
      vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);
    });

    it('looks attachments up in one query and downloads each one once, one at a time', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment(),
        buildAttachment({ id: otherId }),
      ]);
      let inFlight = 0;
      let maxInFlight = 0;
      const findDeliveryFile = vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const readable = Readable.from(Buffer.from('binary-image-data'));
        readable.once('end', () => {
          inFlight -= 1;
        });
        return readable;
      });
      const html = `${htmlWithAttachment(attachmentId)}${htmlWithAttachment(otherId)}${htmlWithAttachment(attachmentId)}`;

      const result = await embed(
        html,
        mock<FileUploader>({ findDeliveryFile }),
      );

      expect(result).not.toContain('/attachment/');
      expect(prisma.attachments.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.attachments.findMany).toHaveBeenCalledWith({
        where: { id: { in: [attachmentId, otherId] } },
      });
      expect(findDeliveryFile).toHaveBeenCalledTimes(2);
      expect(maxInFlight).toBe(1);
    });

    it('leaves the src untouched when the storage cannot find the file', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment(),
      ]);
      const html = htmlWithAttachment(attachmentId);

      const result = await embed(
        html,
        mock<FileUploader>({
          findDeliveryFile: vi
            .fn()
            .mockRejectedValue(new Error('does not exist in AWS S3')),
        }),
      );

      expect(result).toBe(html);
      expect(fs.existsSync(assetPath(`${attachmentId}.png`))).toBe(false);
    });

    it('still embeds the other images when one of them fails', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment(),
        buildAttachment({ id: otherId }),
      ]);
      const findDeliveryFile = vi.fn(async (attachment) =>
        attachment.id === attachmentId
          ? Promise.reject(new Error('does not exist in GCS'))
          : Readable.from(Buffer.from('binary-image-data')),
      );

      const result = await embed(
        `${htmlWithAttachment(attachmentId)}${htmlWithAttachment(otherId)}`,
        mock<FileUploader>({ findDeliveryFile }),
      );

      expect(result).toBe(
        `${htmlWithAttachment(attachmentId)}<p><img src="_bulk-export-assets/${otherId}.png" alt=""></p>`,
      );
    });

    it('gives up on a download whose stream stalls past the timeout', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment(),
      ]);
      const stalledReadable = new Readable({ read() {} });
      const html = htmlWithAttachment(attachmentId);

      const result = await embed(
        html,
        mock<FileUploader>({
          findDeliveryFile: vi.fn().mockResolvedValue(stalledReadable),
        }),
        { downloadTimeoutMs: 50 },
      );

      expect(result).toBe(html);
      expect(fs.existsSync(assetPath(`${attachmentId}.png`))).toBe(false);
      expect(stalledReadable.destroyed).toBe(true);
    });

    it('gives up on a storage request that never answers within the timeout', async () => {
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment(),
      ]);
      const html = htmlWithAttachment(attachmentId);

      const result = await embed(
        html,
        mock<FileUploader>({
          findDeliveryFile: vi.fn(() => new Promise<never>(() => {})),
        }),
        { downloadTimeoutMs: 50 },
      );

      expect(result).toBe(html);
      expect(fs.existsSync(assetPath(`${attachmentId}.png`))).toBe(false);
    });
  });

  describe('job cancellation', () => {
    beforeEach(() => {
      vi.mocked(isAttachmentAccessibleToViewer).mockResolvedValue(true);
      vi.spyOn(prisma.attachments, 'findMany').mockResolvedValue([
        buildAttachment(),
      ]);
    });

    it('stops a download in progress and rejects with the abort reason', async () => {
      const controller = new AbortController();
      const stalledReadable = new Readable({ read() {} });
      const findDeliveryFile = vi.fn(() => {
        setTimeout(() => controller.abort(new Error('job cleaned up')), 10);
        return Promise.resolve(stalledReadable);
      });

      await expect(
        embed(
          htmlWithAttachment(attachmentId),
          mock<FileUploader>({ findDeliveryFile }),
          { signal: controller.signal },
        ),
      ).rejects.toThrow('job cleaned up');

      expect(stalledReadable.destroyed).toBe(true);
      expect(fs.existsSync(assetPath(`${attachmentId}.png`))).toBe(false);
    });

    it('does not start a download once the job has been cancelled', async () => {
      const controller = new AbortController();
      controller.abort(new Error('job cleaned up'));
      const findDeliveryFile = vi.fn();

      await expect(
        embed(
          htmlWithAttachment(attachmentId),
          mock<FileUploader>({ findDeliveryFile }),
          { signal: controller.signal },
        ),
      ).rejects.toThrow('job cleaned up');

      expect(findDeliveryFile).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(outputDir, '_bulk-export-assets'))).toBe(
        false,
      );
    });
  });
});
