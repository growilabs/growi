import {
  NON_TRANSFERABLE_COLLECTIONS,
  selectTransferableCollections,
} from './non-transferable-collections';

describe('selectTransferableCollections', () => {
  test('drops every declared collection and keeps the rest in order', () => {
    const result = selectTransferableCollections([
      'users',
      'transferkeys',
      'pages',
      'migrations',
      'revisions',
    ]);

    expect(result).toEqual(['users', 'pages', 'revisions']);
  });

  test('returns the input unchanged when it declares nothing to drop', () => {
    const collections = ['users', 'usergroups', 'pages'];

    expect(selectTransferableCollections(collections)).toEqual(collections);
  });

  test('never returns a collection the caller did not pass in', () => {
    // The declaration is a deny-list, not a catalogue: a destination that does not
    // have a collection must not be told to transfer it.
    expect(selectTransferableCollections([])).toEqual([]);
  });

  test('keeps the content collections a migration has to carry', () => {
    // Over-exclusion costs as much as under-exclusion: a content collection wrongly
    // declared here silently fails to migrate.
    const contentCollections = [
      'users',
      'usergroups',
      'usergrouprelations',
      'externalaccounts',
      'pages',
      'revisions',
      'attachments',
      'comments',
      'configs',
      'growiplugins',
    ];

    expect(selectTransferableCollections(contentCollections)).toEqual(
      contentCollections,
    );
  });

  test.each([
    // The transfer runs on this key, and the migration record decides which migration
    // scripts the destination still has to apply.
    'transferkeys',
    'migrations',
    // Login state of the destination's own users.
    'sessions',
    // The attachment payloads travel over the dedicated attachment endpoint instead.
    'attachmentFiles.files',
    'attachmentFiles.chunks',
    // Points at the destination's own vault git repository.
    'vault_namespace_state',
    'vault_user_views',
  ])('drops %s', (collectionName) => {
    expect(selectTransferableCollections([collectionName])).toEqual([]);
    expect(NON_TRANSFERABLE_COLLECTIONS.has(collectionName)).toBe(true);
  });
});
