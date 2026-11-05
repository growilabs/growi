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
 * Directory (relative to a job's html output dir) that downloaded/relayed
 * attachment images are written into. Mirrors `_bulk-export.css`'s
 * leading-underscore convention so pdf-converter's `*.html`-only scan never
 * mistakes these for pages.
 */
const ASSETS_DIRNAME = '_bulk-export-assets';

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
  },
): Promise<string> {
  const matches = [...htmlString.matchAll(ATTACHMENT_IMG_SRC)];
  if (matches.length === 0) {
    return htmlString;
  }

  const { fileUploadService } = crowi;
  const assetsDir = path.join(outputDir, ASSETS_DIRNAME);

  // De-dupe: the same attachment can appear more than once on a page.
  const uniqueIds = [...new Set(matches.map((m) => m[1]))];

  // Batch-fetch instead of one findById per id.
  const attachments = await prisma.attachments.findMany({
    where: { id: { in: uniqueIds } },
  });
  const attachmentById = new Map<string, AttachmentWithComputed>(
    attachments.map((a) => [a.id, a]),
  );

  const replacements = new Map<string, string>();

  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const attachment = attachmentById.get(id);
        if (attachment == null) return;

        const isAccessible = await isAttachmentAccessibleToViewer(
          attachment,
          exportingUser,
          false,
        );
        if (!isAccessible) {
          logger.warn(
            "Skipping attachment %s for bulk export: exporting user can't access the page it belongs to.",
            id,
          );
          return;
        }

        const assetFileName = `${id}${path.extname(attachment.fileName ?? '')}`;
        const assetFilePath = path.join(assetsDir, assetFileName);

        // Written once per job; subsequent pages reusing the same
        // attachment just reference the already-written file.
        if (!fs.existsSync(assetFilePath)) {
          await fs.promises.mkdir(assetsDir, { recursive: true });
          const readable = await fileUploadService.findDeliveryFile(attachment);
          const writeStream = fs.createWriteStream(assetFilePath);
          try {
            await pipeline(readable, writeStream);
          } catch (streamErr) {
            // Don't leave a truncated file behind — a later reference to the
            // same attachment in this job would otherwise treat it as
            // "already downloaded" via the fs.existsSync check above, and
            // silently embed a corrupted image.
            await fs.promises.rm(assetFilePath, { force: true });
            throw streamErr;
          }
        }

        replacements.set(id, toRelativeHref(fileOutputPath, assetFilePath));
      } catch (err) {
        logger.warn(
          'Failed to embed attachment image %s for bulk export: %o',
          id,
          err,
        );
      }
    }),
  );

  if (replacements.size === 0) {
    return htmlString;
  }

  return htmlString.replace(ATTACHMENT_IMG_SRC, (fullMatch, id) => {
    const replacement = replacements.get(id);
    return replacement != null ? `src="${replacement}"` : fullMatch;
  });
}
