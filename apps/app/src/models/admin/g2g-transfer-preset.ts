import { ImportMode } from './import-mode';
import { ImportOptionForPages } from './import-option-for-pages';

/** Which of the two G2G transfer presets the operator picked. */
export type TransferPreset = 'migration' | 'merge';

/**
 * The extra options a `pages` entry must carry.
 *
 * The receiving side's overwrite-params generation
 * (`server/service/import/overwrite-params/index.ts` -> `isImportOptionForPages`)
 * decides eligibility by whether `isOverwriteAuthorWithCurrentUser` exists on the option
 * at all, not by its value, and throws `Invalid option for pages` when it is absent. The
 * migration preset never shows the operator an options screen, so this module has to
 * supply these keys itself or every migration transfer would fail the moment the
 * receiving side builds its import settings.
 */
export interface PagesImportOption {
  readonly mode: ImportMode;
  readonly isOverwriteAuthorWithCurrentUser: boolean;
  readonly makePublicForGrant2: boolean;
  readonly makePublicForGrant4: boolean;
  readonly makePublicForGrant5: boolean;
  readonly initPageMetadatas: boolean;
}

/** The extra option a `revisions` entry must carry, for the same reason as pages. */
export interface RevisionsImportOption {
  readonly mode: ImportMode;
  readonly isOverwriteAuthorWithCurrentUser: boolean;
}

export interface ImportOptionsMap {
  readonly [collectionName: string]:
    | { readonly mode: ImportMode }
    | PagesImportOption
    | RevisionsImportOption;
}

export interface TransferPlan {
  readonly collections: readonly string[];
  readonly optionsMap: ImportOptionsMap;
}

/**
 * Collections left out of {@link isCoherentOptionsMap}'s judgement because the system,
 * not the operator, forces their import method.
 *
 * `configs` may only ever be replaced (the receiving side's `getImportSettingMap`
 * throws for any other mode), and `pages` may never be a plain insert (same guard),
 * which leaves it two legal methods -- replace or upsert -- that cannot be written as a
 * single forced mode (see {@link FORCED_MODE_COLLECTIONS}). Both must stay out of the
 * judgement, or the ordinary merge-preset shape -- `configs` replaced, everything else
 * appended -- would read as a mixed assignment and get refused.
 */
export const COLLECTIONS_EXCLUDED_FROM_COHERENCE: ReadonlySet<string> = new Set(
  ['configs', 'pages'],
);

/**
 * Collections whose import method the system forces to a single value.
 *
 * Kept separate from {@link COLLECTIONS_EXCLUDED_FROM_COHERENCE}: `pages` cannot be
 * expressed here because it has two allowed methods, not one, so it appears only in the
 * coherence exclusion set.
 */
export const FORCED_MODE_COLLECTIONS: ReadonlyMap<string, ImportMode> = new Map(
  [['configs', ImportMode.flushAndInsert]],
);

/**
 * The pages extra-option defaults, read off `ImportOptionForPages` itself rather than
 * restated here, so the two never drift apart.
 */
const buildPagesOption = (mode: ImportMode): PagesImportOption => {
  const defaults = new ImportOptionForPages('pages');
  return {
    mode,
    isOverwriteAuthorWithCurrentUser: defaults.isOverwriteAuthorWithCurrentUser,
    makePublicForGrant2: defaults.makePublicForGrant2,
    makePublicForGrant4: defaults.makePublicForGrant4,
    makePublicForGrant5: defaults.makePublicForGrant5,
    initPageMetadatas: defaults.initPageMetadatas,
  };
};

/**
 * The revisions extra-option default.
 *
 * `ImportOptionForRevisions` (`models/admin/import-option-for-revisions.ts`) sets this
 * same value via its own `DEFAULT_PROPS` at construction time, but -- unlike
 * `ImportOptionForPages` -- it does not `declare` the field on the class, so there is no
 * type-checked way to read it back off an instance. Kept as a literal for that reason;
 * if that file's default ever changes, this one must change with it.
 */
const REVISIONS_DEFAULT_IS_OVERWRITE_AUTHOR_WITH_CURRENT_USER = false;

const buildRevisionsOption = (mode: ImportMode): RevisionsImportOption => ({
  mode,
  isOverwriteAuthorWithCurrentUser:
    REVISIONS_DEFAULT_IS_OVERWRITE_AUTHOR_WITH_CURRENT_USER,
});

/**
 * Builds the migration preset's transfer plan: every transferable collection is
 * targeted and every one of them is replaced. The operator is not asked to choose
 * collections or a method (requirements 1.2, 2.1, 2.2, 2.6).
 */
export function buildMigrationTransferPlan(
  transferableCollections: readonly string[],
): TransferPlan {
  const optionsMap: Record<string, ImportOptionsMap[string]> = {};

  for (const collectionName of transferableCollections) {
    const mode =
      FORCED_MODE_COLLECTIONS.get(collectionName) ?? ImportMode.flushAndInsert;

    if (collectionName === 'pages') {
      optionsMap[collectionName] = buildPagesOption(mode);
    } else if (collectionName === 'revisions') {
      optionsMap[collectionName] = buildRevisionsOption(mode);
    } else {
      optionsMap[collectionName] = { mode };
    }
  }

  return {
    collections: [...transferableCollections],
    optionsMap,
  };
}

/**
 * Builds the merge preset's transfer plan: exactly what the operator selected, with no
 * new rule applied.
 */
export function buildMergeTransferPlan(
  selectedCollections: readonly string[],
  optionsMap: ImportOptionsMap,
): TransferPlan {
  return {
    collections: [...selectedCollections],
    optionsMap,
  };
}

/**
 * Judges whether an import-method assignment is coherent: every targeted collection is
 * replaced, or none of them are. Collections whose method the system forces
 * ({@link COLLECTIONS_EXCLUDED_FROM_COHERENCE}) are left out of the judgement, and only
 * collections named in `collections` are looked at -- a leftover entry in `optionsMap`
 * for a collection no longer in `collections` cannot make the assignment look mixed
 * (requirement 5.8).
 */
export function isCoherentOptionsMap(
  optionsMap: ImportOptionsMap,
  collections: readonly string[],
): boolean {
  const modes = collections
    .filter(
      (collectionName) =>
        !COLLECTIONS_EXCLUDED_FROM_COHERENCE.has(collectionName),
    )
    .map((collectionName) => optionsMap[collectionName]?.mode);

  const hasReplace = modes.some((mode) => mode === ImportMode.flushAndInsert);
  const hasNonReplace = modes.some(
    (mode) => mode !== ImportMode.flushAndInsert,
  );

  return !(hasReplace && hasNonReplace);
}
