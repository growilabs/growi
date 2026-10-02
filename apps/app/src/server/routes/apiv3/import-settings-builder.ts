import type { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import type { ImportSettings } from '~/server/service/import';
import { generateOverwriteParams } from '~/server/service/import/overwrite-params';

/**
 * Build the per-collection ImportSettings map consumed by ImportService.import().
 *
 * Extracted as a pure function so the route handler can wrap it in the same
 * try/catch pattern as the neighboring unzip/validate blocks (see #11341):
 * before this extraction, a missing/malformed option here threw AFTER
 * res.apiv3() had already responded, so the rejection escaped as an
 * unhandled rejection instead of reaching the client.
 */
export const buildImportSettingsMap = (
  fileStatsToImport: { fileName: string; collectionName: string }[],
  options: GrowiArchiveImportOption[],
  operatorUserId: string,
): Map<string, ImportSettings> => {
  // Use the Map for a potential fix for the code scanning alert no. 895: Prototype-polluting assignment
  const importSettingsMap = new Map<string, ImportSettings>();

  fileStatsToImport.forEach(({ fileName, collectionName }) => {
    // instanciate GrowiArchiveImportOption
    const option = options.find((opt) => opt.collectionName === collectionName);
    if (option == null) {
      throw new Error(`Import option for ${collectionName} is not found`);
    }

    // generate options
    const importSettings = {
      mode: option.mode,
      jsonFileName: fileName,
      overwriteParams: generateOverwriteParams(
        collectionName,
        // consumers reconstruct via `new ObjectId(...)`, so the hex string is equivalent
        operatorUserId,
        option,
      ),
    } satisfies ImportSettings;

    importSettingsMap.set(collectionName, importSettings);
  });

  return importSettingsMap;
};
