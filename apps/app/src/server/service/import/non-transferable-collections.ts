/**
 * The collections a GROWI-to-GROWI transfer must never carry.
 *
 * **Criterion for adding one here: the collection holds the operating state of that
 * particular GROWI environment rather than GROWI content.** Content is what the operator
 * moved for — pages, users, groups, attachments metadata, settings. Operating state is
 * what only means something to the instance that produced it: the key the transfer itself
 * is running on, the record of which migration scripts this database has had applied,
 * where a change stream left off, who is currently logged in.
 *
 * Both directions of a wrong call cost the same. A collection missing from this list is
 * replaced during a migration transfer, so the destination loses operating state it needs
 * (a stale `migrations` record makes the destination re-run migration scripts it has
 * already applied). A content collection wrongly listed here never reaches the
 * destination at all, and nothing reports that it did not. **When it is genuinely
 * unclear, leave the collection out of this list** — a transferred collection is visible
 * and correctable, a silently skipped one is not.
 *
 * Deliberately absent, after reading the code that owns them:
 * - `growiplugins` — the plugin repositories themselves live on the destination's disk,
 *   but `GrowiPluginService.downloadNotExistPluginRepositories()` re-downloads any
 *   repository that is missing from the filesystem using the recorded `origin`, so the
 *   documents alone are enough for the destination to restore the operator's plugins.
 * - `attachments` — attachment metadata is content and is transferred; only the payload
 *   collections below are excluded.
 * - `pagelinks` — the backlink index. It is a cache derived from page bodies, so it looks
 *   like a rebuildable artifact, but it is derived from content the transfer itself
 *   carries and holds nothing but page references, which the transfer preserves — so the
 *   rows stay valid at the destination, exactly as `pagetagrelations` does. Unlike
 *   `yjs-writings` it does not regenerate on its own: rows are only rewritten when a page
 *   is next saved, so skipping it would leave backlinks silently empty until every page
 *   had been edited.
 */
export const NON_TRANSFERABLE_COLLECTIONS: ReadonlySet<string> = new Set([
  // The key this very transfer authenticates with, plus the record of which migration
  // scripts this database has had applied.
  'transferkeys',
  'migrations',

  // Where the change stream consumers left off in this database's oplog.
  'changestream_resume_tokens',

  // Login state and rate-limit counters of the destination's own visitors.
  'sessions',
  'rlflx',

  // The audit log of what happened in this environment, and how far it has been synced
  // to this environment's Elasticsearch.
  'activities',
  'auditlog_es_sync_status',

  // Jobs that were running in this environment. Their progress, cursors and temporary
  // snapshots refer to this instance's filesystem and process state.
  'auditlogbulkexportjobs',
  'pagebulkexportjobs',
  'pagebulkexportpagesnapshots',
  'pageoperations',

  // Mail that this environment failed to send and will retry.
  'failedemails',

  // A cache of the model catalogue this environment last fetched from the AI providers.
  'mastra_refreshed_model_catalog',

  // GROWI Vault state. Every one of these points into the destination's own git
  // repository (commit OIDs, composed view refs) or is a queue that this environment's
  // vault-manager is working through.
  'vault_instructions',
  'vault_namespace_state',
  'vault_reconcile_log',
  'vault_sync_state',
  'vault_user_views',

  // The attachment payloads. They travel over the dedicated attachment endpoint after
  // the collections are imported, not inside the archive.
  'attachmentFiles.files',
  'attachmentFiles.chunks',

  // The collaborative editor's working documents, superseded by the transferred
  // revisions the moment the destination is opened again.
  'yjs-writings',
]);

/**
 * The other half of the ledger: collections that were looked at and found to hold GROWI
 * content, so a transfer carries them.
 *
 * Nothing reads this at runtime — {@link selectTransferableCollections} is a deny-list, so
 * an unlisted collection is transferred anyway. It exists so that a collection added to
 * GROWI after this list was written cannot pass unnoticed: the drift test
 * (non-transferable-collections.integ.ts) fails on any collection that appears in neither
 * declaration, which is the only moment anyone is prompted to make the call.
 */
export const TRANSFERABLE_COLLECTIONS: ReadonlySet<string> = new Set([
  'accesstokens',
  'aiassistants',
  'attachments',
  'bookmarkfolders',
  'bookmarks',
  'comments',
  'configs',
  'contributions',
  'editorsettings',
  'externalaccounts',
  'externalusergrouprelations',
  'externalusergroups',
  'globalnotificationsettings',
  'growiplugins',
  'inappnotifications',
  'inappnotificationsettings',
  'namedqueries',
  'newsitems',
  'newsreadstatuses',
  'pagelinks',
  'pageredirects',
  'pages',
  'pagetagrelations',
  'passwordresetorders',
  'revisions',
  'sharelinks',
  'slackappintegrations',
  'subscriptions',
  'tags',
  'threadrelations',
  'updateposts',
  'usergrouprelations',
  'usergroups',
  'userregistrationorders',
  'users',
  'useruisettings',
  'vectorstorefilerelations',
  'vectorstores',
]);

/**
 * Narrows a list of collection names down to the ones a transfer may carry.
 *
 * Takes the list as an argument rather than reading the database itself, so that the push
 * route, the receive route and the drift test all run the same judgement over whichever
 * list they hold.
 */
export function selectTransferableCollections(
  allCollectionNames: readonly string[],
): readonly string[] {
  return allCollectionNames.filter(
    (collectionName) => !NON_TRANSFERABLE_COLLECTIONS.has(collectionName),
  );
}

/**
 * Removes the declared collections from a transfer request.
 *
 * The collection list and the import-options map are narrowed **together** because
 * dropping only one of them breaks the other side: an option left behind for a collection
 * that is no longer transferred is still a mode the destination has to reconcile, and the
 * mixed-mode check the migration preset adds would read it as a contradiction and refuse
 * the whole transfer — exactly the "drop it and carry on" case of requirement 5.8.
 */
export function excludeNonTransferableCollections<TOption>(request: {
  readonly collections: readonly string[];
  readonly optionsMap: Readonly<Record<string, TOption>>;
}): {
  collections: string[];
  optionsMap: Record<string, TOption>;
} {
  return {
    collections: [...selectTransferableCollections(request.collections)],
    optionsMap: Object.fromEntries(
      Object.entries(request.optionsMap).filter(
        ([collectionName]) => !NON_TRANSFERABLE_COLLECTIONS.has(collectionName),
      ),
    ),
  };
}
