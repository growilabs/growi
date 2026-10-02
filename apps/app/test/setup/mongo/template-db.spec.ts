import { assertIndexParity } from './template-db';

describe('assertIndexParity', () => {
  it('does not throw when the target has the same non-default indexes as the source', () => {
    const sourceIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'username_1', key: { username: 1 }, unique: true },
    ];
    const targetIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'username_1', key: { username: 1 }, unique: true },
    ];

    expect(() =>
      assertIndexParity(sourceIndexes, targetIndexes, 'users'),
    ).not.toThrow();
  });

  it('ignores index order and the default _id_ index', () => {
    const sourceIndexes = [
      { name: 'a_1', key: { a: 1 } },
      { name: 'b_1', key: { b: 1 } },
    ];
    const targetIndexes = [
      { name: '_id_', key: { _id: 1 } },
      { name: 'b_1', key: { b: 1 } },
      { name: 'a_1', key: { a: 1 } },
    ];

    expect(() =>
      assertIndexParity(sourceIndexes, targetIndexes, 'widgets'),
    ).not.toThrow();
  });

  it('throws when the target is missing an index the source has', () => {
    const sourceIndexes = [{ name: 'key_1', key: { key: 1 }, unique: true }];
    const targetIndexes: typeof sourceIndexes = [];

    expect(() =>
      assertIndexParity(
        sourceIndexes,
        targetIndexes,
        'auditlog_es_sync_status',
      ),
    ).toThrow(/auditlog_es_sync_status/);
  });

  it('throws when an index key differs between source and target', () => {
    const sourceIndexes = [{ name: 'key_1', key: { key: 1 }, unique: true }];
    const targetIndexes = [{ name: 'key_1', key: { key: -1 }, unique: true }];

    expect(() =>
      assertIndexParity(
        sourceIndexes,
        targetIndexes,
        'changestream_resume_tokens',
      ),
    ).toThrow();
  });
});
