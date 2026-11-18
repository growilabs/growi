import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IUser } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import type { AttachmentWithComputed } from '~/server/models/attachment';
import { isAttachmentAccessibleToViewer } from '~/server/service/attachment/resolve-accessible-attachment';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { toRelativeHref } from './to-relative-href';

const logger = loggerFactory('growi:features:page-bulk-export:embed-images');

/**
 * Matches `<img ... src="/attachment/<24-char hex id>" ...>` — the app-root
 * relative path GROWI's web renderer emits for attachment images (see
 * apps/app/src/server/routes/attachment/get.ts's `/:id([0-9a-z]{24})` route).
 *
 * pdf-converter opens the exported HTML via `file://` (see
 * apps/pdf-converter/src/service/pdf-convert.ts), which has no origin to
 * resolve an app-root-relative path against, so these must be rewritten
 * before the HTML is written to disk (Requirement: images must render in
 * the exported PDF, not just links/text).
 */
const ATTACHMENT_IMG_SRC = /src="\/attachment\/([0-9a-z]{24})"/g;

/**
 * Directory (relative to a job's html output dir) that downloaded attachment
 * images are written into, once per job. pdf-converter scans the job dir
 * recursively for `*.html`, so the directory name does not keep assets out
 * of that scan — the extensions chosen by `toAssetFileName` do.
 */
const ASSETS_DIRNAME = '_bulk-export-assets';

/**
 * File extensions for image content types whose rendering in pdf-converter's
 * Chromium depends on the extension (SVG renders only as `.svg`). Other
 * `image/*` types are saved without an extension: Chromium sniffs raster
 * images from their bytes.
 */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

/**
 * Image file-name extensions accepted for an `application/octet-stream`
 * upload, i.e. one whose type the uploading client could not tell.
 */
const IMAGE_FILE_NAME_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.values(IMAGE_EXTENSIONS),
  '.jpeg',
]);

/**
 * Name of the local copy of an attachment, or `undefined` when it must not be
 * embedded. Image content types qualify, with the extension taken from the
 * content type. An `application/octet-stream` upload qualifies only when its
 * file name has an extension in `IMAGE_FILE_NAME_EXTENSIONS`. Any other
 * extension from the uploaded file name is never used: a `.html` asset would
 * be converted by pdf-converter as if it were a page.
 */
function toAssetFileName(
  attachment: AttachmentWithComputed,
): string | undefined {
  const { id, fileFormat, fileName } = attachment;
  if (fileFormat.startsWith('image/')) {
    return `${id}${IMAGE_EXTENSIONS[fileFormat] ?? ''}`;
  }
  if (fileFormat === 'application/octet-stream') {
    const extension = path.extname(fileName).toLowerCase();
    if (IMAGE_FILE_NAME_EXTENSIONS.has(extension)) {
      return `${id}${extension}`;
    }
  }
  return undefined;
}

/**
 * Rewrite `/attachment/<id>` image sources in `htmlString` to something
 * `pdf-converter`'s `file://` navigation can actually load: the attachment's
 * bytes are fetched server-side via `fileUploadService.findDeliveryFile()`
 * (this runs inside the `app` process, which already has full access to
 * fileUploadService — no HTTP round-trip or session cookie needed) and
 * saved once per job into `ASSETS_DIRNAME` on the shared
 * `page_bulk_export_tmp` volume; the `src` becomes a relative path to that
 * local copy, same pattern as the shared CSS file.
 *
 * This is independent of the storage's response mode: RELAY / REDIRECT /
 * DELEGATE only decide how the `/attachment/:id` route answers a browser,
 * while `findDeliveryFile()` reads with the app's own credentials in every
 * mode. Signed URLs are deliberately not used, since they can expire before
 * pdf-converter loads the HTML (see growilabs/growi#11830).
 *
 * Reuses `isAttachmentAccessibleToViewer` — the same page-viewer permission
 * check the `/attachment/:id` route enforces via `resolveAccessibleAttachment`
 * (see retrieveAttachmentFromIdParam in apps/app/src/server/routes/attachment/get.ts):
 * an attachment ID parsed out of the rendered HTML could belong to a
 * different, private page the exporting user isn't allowed to read, so each
 * attachment is checked before it is fetched/embedded. Attachments with no
 * `page` (e.g. profile images) skip this check, same as the attachment route.
 */
export async function embedAttachmentImages(
  htmlString: string,
  {
    fileOutputPath,
    outputDir,
    crowi,
    exportingUser,
    downloadTimeoutMs,
    signal,
  }: {
    /** absolute path the HTML will be written to (used to compute the
     * relative href to ASSETS_DIRNAME) */
    fileOutputPath: string;
    /** the job's html output dir (ASSETS_DIRNAME lives directly under this,
     * once per job — shared across pages, like the CSS file) */
    outputDir: string;
    /** crowi instance (for fileUploadService + Attachment lookups) */
    crowi: Crowi;
    /** the user who requested the export (pageBulkExportJob.user, resolved
     * once per job by the caller) — permission checks run as this user */
    exportingUser: HydratedDocument<IUser> | undefined;
    /** upper bound for downloading a single attachment, storage request
     * included; an image that takes longer is left out of the PDF */
    downloadTimeoutMs: number;
    /** aborts when the export job is cleaned up; embedding then stops and
     * rejects with `signal.reason` instead of skipping the image */
    signal: AbortSignal;
  },
): Promise<string> {
  const matches = [...htmlString.matchAll(ATTACHMENT_IMG_SRC)];
  if (matches.length === 0) {
    return htmlString;
  }

  // De-dupe: the same attachment can appear more than once on a page.
  const uniqueIds = [...new Set(matches.map((m) => m[1]))];

  // Batch-fetch instead of one findById per id.
  const attachments = await prisma.attachments.findMany({
    where: { id: { in: uniqueIds } },
  });

  const assetOptions: AssetOptions = {
    assetsDir: path.join(outputDir, ASSETS_DIRNAME),
    fileUploadService: crowi.fileUploadService,
    exportingUser,
    downloadTimeoutMs,
    signal,
  };
  const replacements = new Map<string, string>();
  // One download at a time: with cloud storage every download is a network
  // request, and a page may reference hundreds of images.
  for (const attachment of attachments) {
    signal.throwIfAborted();
    // biome-ignore lint/performance/noAwaitInLoops: downloads are deliberately sequential (see above)
    const assetFilePath = await prepareAsset(attachment, assetOptions);
    if (assetFilePath != null) {
      replacements.set(
        attachment.id,
        toRelativeHref(fileOutputPath, assetFilePath),
      );
    }
  }

  if (replacements.size === 0) {
    return htmlString;
  }

  return htmlString.replace(ATTACHMENT_IMG_SRC, (fullMatch, id) => {
    const replacement = replacements.get(id);
    return replacement != null ? `src="${replacement}"` : fullMatch;
  });
}

type AssetOptions = {
  assetsDir: string;
  fileUploadService: Crowi['fileUploadService'];
  exportingUser: HydratedDocument<IUser> | undefined;
  downloadTimeoutMs: number;
  signal: AbortSignal;
};

/**
 * Make sure the job has a local copy of `attachment` and return its path, or
 * `undefined` when the image is to be left out of the PDF (no access, not an
 * image, or the download failed). Best effort: a failure only drops this
 * image, never the page — unless the job itself is cancelled.
 */
async function prepareAsset(
  attachment: AttachmentWithComputed,
  {
    assetsDir,
    fileUploadService,
    exportingUser,
    downloadTimeoutMs,
    signal,
  }: AssetOptions,
): Promise<string | undefined> {
  try {
    const isAccessible = await isAttachmentAccessibleToViewer(
      attachment,
      exportingUser,
      false,
    );
    if (!isAccessible) {
      logger.warn(
        "Skipping attachment %s for bulk export: exporting user can't access the page it belongs to.",
        attachment.id,
      );
      return undefined;
    }

    const assetFileName = toAssetFileName(attachment);
    if (assetFileName == null) {
      logger.warn(
        'Skipping attachment %s for bulk export: content type %s is not an image.',
        attachment.id,
        attachment.fileFormat,
      );
      return undefined;
    }
    const assetFilePath = path.join(assetsDir, assetFileName);

    // Written once per job; subsequent pages reusing the same
    // attachment just reference the already-written file.
    if (!fs.existsSync(assetFilePath)) {
      await fs.promises.mkdir(assetsDir, { recursive: true });
      await downloadAsset(
        fileUploadService,
        attachment,
        assetFilePath,
        AbortSignal.any([signal, AbortSignal.timeout(downloadTimeoutMs)]),
      );
    }
    return assetFilePath;
  } catch (err) {
    if (signal.aborted) {
      throw signal.reason;
    }
    logger.warn(
      'Failed to embed attachment image %s for bulk export: %o',
      attachment.id,
      err,
    );
    return undefined;
  }
}

async function downloadAsset(
  fileUploadService: Crowi['fileUploadService'],
  attachment: AttachmentWithComputed,
  assetFilePath: string,
  signal: AbortSignal,
): Promise<void> {
  const readable = await untilAborted(
    fileUploadService.findDeliveryFile(attachment),
    signal,
  );
  try {
    await pipeline(readable, fs.createWriteStream(assetFilePath), { signal });
  } catch (err) {
    // Don't leave a truncated file behind — a later reference to the same
    // attachment in this job would otherwise treat it as "already
    // downloaded" via the fs.existsSync check in prepareAsset, and silently
    // embed a corrupted image.
    await fs.promises.rm(assetFilePath, { force: true });
    throw err;
  }
}

/**
 * Settle with `readablePromise`, or reject with `signal.reason` as soon as
 * `signal` aborts — `findDeliveryFile()` takes no signal of its own, and the
 * storage request behind it can hang. A stream that arrives after the abort
 * is destroyed so its connection is not left open.
 */
function untilAborted(
  readablePromise: Promise<NodeJS.ReadableStream>,
  signal: AbortSignal,
): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    readablePromise.then(
      (readable) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          if ('destroy' in readable && typeof readable.destroy === 'function') {
            readable.destroy();
          }
          return;
        }
        resolve(readable);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}
