import { describe, expect, it } from 'vitest';

import { ChatRelation } from './chat-relation';

describe('ChatRelation schema', () => {
  const allFields = [
    'relationId',
    'proxyUri',
    'platform',
    'workspaceId',
    'workspaceName',
    'label',
    'state',
    'settingsVersion',
    'createdAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatRelation.schema.path(field)).toBeDefined();
  });

  it('state enum contains exactly active and unpaired', () => {
    const path = ChatRelation.schema.path('state');
    const enumValues = (path as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(expect.arrayContaining(['active', 'unpaired']));
    expect(enumValues).toHaveLength(2);
  });

  it('state defaults to active', () => {
    const path = ChatRelation.schema.path('state');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(
      'active',
    );
  });

  // An active relation must carry no unpaired instant at all: re-pairing
  // picks its inheritance source by ordering on this field, and a non-null
  // default would make every active row look like a candidate source.
  it('unpairedAt defaults to null', () => {
    const path = ChatRelation.schema.path('unpairedAt');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(
      null,
    );
  });

  it('settingsVersion defaults to 0', () => {
    const path = ChatRelation.schema.path('settingsVersion');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(0);
  });

  const getIndexes = () =>
    ChatRelation.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares relationId as a SINGLE-column unique index (never compound)', () => {
    const indexes = getIndexes();
    const relationIdIndex = indexes.find(
      ([fields]) => fields.relationId !== undefined,
    );
    expect(relationIdIndex).toBeDefined();
    if (relationIdIndex == null) return;
    const [fields, options] = relationIdIndex;
    // The invariant this task must not violate: design.md explicitly
    // rejects a (proxyUri, relationId) compound key.
    expect(Object.keys(fields)).toEqual(['relationId']);
    expect(options.unique).toBe(true);
  });

  it('uses collection name chat_relations', () => {
    const collectionName = (
      ChatRelation.schema as unknown as { options?: { collection?: string } }
    ).options?.collection;
    expect(collectionName).toBe('chat_relations');
  });
});
