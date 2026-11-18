import type { PostExtractBody } from '@growi/attachment-text-extractor-client';

import type { AttachmentWithComputed } from '~/server/models/attachment';

const USABLE_EXTENSION = /^[a-z0-9]{1,16}$/;

const extensionOf = (name: string): string | null => {
  const dot = name.lastIndexOf('.');
  if (dot === -1) {
    return null;
  }
  const extension = name
    .slice(dot + 1)
    .trim()
    .toLowerCase();
  return USABLE_EXTENSION.test(extension) ? extension : null;
};

/**
 * Builds the multipart body of POST /extract for an attachment.
 *
 * The extractor reads the file name only for its extension, so the original
 * name (user input: any length, any characters) never leaves the app; the part
 * is named `file.<extension>`. For the same reason the stored MIME type is not
 * put in the part's Content-Type header, which the extractor does not read.
 *
 * The extractor lets a `mimeType` it knows override the extension. The stored
 * MIME type is what the uploading browser declared and can contradict the
 * extension (a CSV uploaded from Windows with Excel is stored as
 * application/vnd.ms-excel), so it is sent only when there is no extension to
 * go by.
 */
export const buildExtractRequestBody = (
  chunks: Buffer[],
  attachment: Pick<
    AttachmentWithComputed,
    'originalName' | 'fileName' | 'fileFormat'
  >,
): PostExtractBody => {
  const extension = extensionOf(attachment.originalName ?? attachment.fileName);
  const file = new File(
    // The DOM typing of BlobPart rejects a view over a SharedArrayBuffer,
    // which the Node typing of Buffer allows; Node's File takes any Buffer.
    chunks as BlobPart[],
    extension == null ? 'file' : `file.${extension}`,
  );
  return extension == null && attachment.fileFormat !== ''
    ? { file, mimeType: attachment.fileFormat }
    : { file };
};
