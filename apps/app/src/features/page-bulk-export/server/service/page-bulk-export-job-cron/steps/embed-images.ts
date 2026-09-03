import fs from 'node:fs';
import path from 'node:path';

import type Crowi from '~/server/crowi';
import { ResponseMode } from '~/server/interfaces/attachment';
import { Attachment } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

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
 * `pdf-converter`'s `file://` navigation can actually load. Only handles
 * RELAY-mode storage (the local filesystem and GridFS `fileUploadService`
 * implementations): the attachment's bytes are fetched server-side (this
 * runs inside the `app` process, which already has full access to
 * fileUploadService — no HTTP round-trip or session cookie needed) and
 * saved once per job into `ASSETS_DIRNAME` on the shared
 * `page_bulk_export_tmp` volume; the `src` becomes a relative path to that
 * local copy, same pattern as the shared CSS file.
 *
 * REDIRECT-mode (S3/GCS) and DELEGATE-mode storage are not handled here and
 * are left as-is (best effort — the image will be missing from the PDF,
 * but the page still converts). See growilabs/growi#<ISSUE_NUMBER> for
 * background and follow-up on those modes.
 *
 * @param htmlString rendered page HTML, before it is written to fileOutputPath
 * @param fileOutputPath absolute path the HTML will be written to (used to
 *   compute the relative href to `ASSETS_DIRNAME`)
 * @param outputDir the job's html output dir (ASSETS_DIRNAME lives directly
 *   under this, once per job — shared across pages, like the CSS file)
 * @param crowi crowi instance (for fileUploadService + Attachment lookups)
 */
export async function embedAttachmentImages(
  htmlString: string,
  fileOutputPath: string,
  outputDir: string,
  crowi: Crowi,
): Promise<string> {
  const matches = [...htmlString.matchAll(ATTACHMENT_IMG_SRC)];
  if (matches.length === 0) {
    return htmlString;
  }

  const { fileUploadService } = crowi;
  if (fileUploadService.determineResponseMode() !== ResponseMode.RELAY) {
    // REDIRECT (S3/GCS) and DELEGATE modes aren't handled yet; leave the
    // HTML untouched rather than guess.
    return htmlString;
  }

  const assetsDir = path.join(outputDir, ASSETS_DIRNAME);

  // De-dupe: the same attachment can appear more than once on a page.
  const uniqueIds = [...new Set(matches.map((m) => m[1]))];

  const replacements = new Map<string, string>();

  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const attachment = await Attachment.findById(id);
        if (attachment == null) return;

        const readable = await fileUploadService.findDeliveryFile(attachment);
        const assetFileName = `${id}${path.extname(attachment.fileName ?? '')}`;
        const assetFilePath = path.join(assetsDir, assetFileName);

        // Written once per job; subsequent pages reusing the same
        // attachment just reference the already-written file.
        if (!fs.existsSync(assetFilePath)) {
          await fs.promises.mkdir(assetsDir, { recursive: true });
          const writeStream = fs.createWriteStream(assetFilePath);
          await new Promise<void>((resolve, reject) => {
            readable.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            readable.on('error', reject);
          });
        }

        const relativeHref = path
          .relative(path.dirname(fileOutputPath), assetFilePath)
          .split(path.sep)
          .map(encodeURIComponent)
          .join('/');
        replacements.set(id, relativeHref);
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
