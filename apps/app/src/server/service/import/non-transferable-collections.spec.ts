import {
  excludeNonTransferableCollections,
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

  test('never returns a mutated copy of the caller’s array', () => {
    const collections = ['users', 'transferkeys'];
    selectTransferableCollections(collections);

    expect(collections).toEqual(['users', 'transferkeys']);
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

describe('excludeNonTransferableCollections', () => {
  test('drops a protected collection from the list and from its import option', () => {
    const result = excludeNonTransferableCollections({
      collections: ['users', 'transferkeys', 'pages'],
      optionsMap: {
        users: { mode: 'insert' },
        transferkeys: { mode: 'insert' },
        pages: { mode: 'upsert' },
      },
    });

    expect(result.collections).toEqual(['users', 'pages']);
    // Leaving the option behind is what turns "drop it and carry on" into a refused
    // transfer once the mixed-mode check reads the leftover as a contradiction.
    expect(result.optionsMap).toEqual({
      users: { mode: 'insert' },
      pages: { mode: 'upsert' },
    });
  });

  test('passes a request that names nothing protected through unchanged', () => {
    const request = {
      collections: ['users', 'pages'],
      optionsMap: { users: { mode: 'insert' }, pages: { mode: 'upsert' } },
    };

    const result = excludeNonTransferableCollections(request);

    expect(result.collections).toEqual(request.collections);
    expect(result.optionsMap).toEqual(request.optionsMap);
  });

  test('leaves the caller’s request untouched', () => {
    const request = {
      collections: ['users', 'transferkeys'],
      optionsMap: {
        users: { mode: 'insert' },
        transferkeys: { mode: 'insert' },
      },
    };

    excludeNonTransferableCollections(request);

    expect(request.collections).toEqual(['users', 'transferkeys']);
    expect(Object.keys(request.optionsMap)).toEqual(['users', 'transferkeys']);
  });
});
