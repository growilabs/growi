import { classify, mergeTranslations } from './diff-classifier';

describe('classify', () => {
  it('returns no_change when before and after are identical', () => {
    const before = { editor_guide: { decoration: 'Decoration' } };
    const after = { editor_guide: { decoration: 'Decoration' } };

    const result = classify({ before, after });

    expect(result).toEqual({ kind: 'no_change' });
  });

  it('returns translation_only with the changed leaf key path when only a value changes', () => {
    const before = { editor_guide: { decoration: 'Decoration' } };
    const after = { editor_guide: { decoration: 'Décoration' } };

    const result = classify({ before, after });

    expect(result).toEqual({
      kind: 'translation_only',
      changedKeys: ['editor_guide.decoration'],
    });
  });

  it('returns structural with the added leaf key path and empty removedKeys when a key is added', () => {
    const before = { editor_guide: { decoration: 'Decoration' } };
    const after = {
      editor_guide: { decoration: 'Decoration', outline: 'Outline' },
    };

    const result = classify({ before, after });

    expect(result).toEqual({
      kind: 'structural',
      addedKeys: ['editor_guide.outline'],
      removedKeys: [],
    });
  });

  it('returns structural with the removed leaf key path and empty addedKeys when a key is removed', () => {
    const before = {
      editor_guide: { decoration: 'Decoration', outline: 'Outline' },
    };
    const after = { editor_guide: { decoration: 'Decoration' } };

    const result = classify({ before, after });

    expect(result).toEqual({
      kind: 'structural',
      addedKeys: [],
      removedKeys: ['editor_guide.outline'],
    });
  });

  it('classifies a rename as add+remove (no dedicated rename kind exists)', () => {
    const before = { editor_guide: { old_key: 'Old' } };
    const after = { editor_guide: { new_key: 'Old' } };

    const result = classify({ before, after });

    expect(result).toEqual({
      kind: 'structural',
      addedKeys: ['editor_guide.new_key'],
      removedKeys: ['editor_guide.old_key'],
    });
  });

  it('does not conflate translation_only with structural: a value-only change never reports added/removed keys', () => {
    const before = { a: { b: 'x' } };
    const after = { a: { b: 'y' } };

    const result = classify({ before, after });

    expect(result.kind).toBe('translation_only');
    expect(result).not.toHaveProperty('addedKeys');
    expect(result).not.toHaveProperty('removedKeys');
  });

  it('does not report no_change when a key set actually differs (guards against an always-no_change stub)', () => {
    const before = { a: { b: 'x' } };
    const after = { a: { b: 'x', c: 'y' } };

    const result = classify({ before, after });

    expect(result.kind).not.toBe('no_change');
    expect(result).toEqual({
      kind: 'structural',
      addedKeys: ['a.c'],
      removedKeys: [],
    });
  });

  it('ignores an existing key whose after value is empty (no translation yet, not a removal)', () => {
    const before = { editor_guide: { decoration: 'Decoration' } };
    const after = { editor_guide: { decoration: '' } };

    const result = classify({ before, after });

    expect(result).toEqual({ kind: 'no_change' });
  });

  it('ignores a newly-termed key whose after value is empty (no translation yet, not an addition)', () => {
    const before = { editor_guide: { decoration: 'Decoration' } };
    const after = { editor_guide: { decoration: 'Decoration', outline: '' } };

    const result = classify({ before, after });

    expect(result).toEqual({ kind: 'no_change' });
  });

  it('still reports a real translation_only change alongside other keys left empty (untranslated)', () => {
    const before = {
      editor_guide: { decoration: 'Decoration', outline: 'Outline' },
    };
    const after = {
      editor_guide: { decoration: 'Décoration', outline: '' },
    };

    const result = classify({ before, after });

    expect(result).toEqual({
      kind: 'translation_only',
      changedKeys: ['editor_guide.decoration'],
    });
  });

  it('still reports a genuine removal when a key is truly absent from after (not merely empty)', () => {
    const before = {
      editor_guide: { decoration: 'Decoration', outline: 'Outline' },
    };
    const after = { editor_guide: { decoration: '' } };

    const result = classify({ before, after });

    expect(result).toEqual({
      kind: 'structural',
      addedKeys: [],
      removedKeys: ['editor_guide.outline'],
    });
  });
});

describe('mergeTranslations', () => {
  it('keeps the existing value for a key POEditor has not translated yet (after is empty)', () => {
    const before = { a: { k1: '既存の訳1', k2: '既存の訳2' } };
    const after = { a: { k1: '新しい訳1', k2: '' } };

    expect(mergeTranslations(before, after)).toEqual({
      a: { k1: '新しい訳1', k2: '既存の訳2' },
    });
  });

  it('does not insert a brand-new key whose only value is an empty string', () => {
    const before = { a: { k1: 'x' } };
    const after = { a: { k1: 'x', k2: '' } };

    expect(mergeTranslations(before, after)).toEqual({ a: { k1: 'x' } });
  });

  it('inserts a brand-new key that has a real (non-empty) value', () => {
    const before = { a: { k1: 'x' } };
    const after = { a: { k1: 'x', k2: 'y' } };

    expect(mergeTranslations(before, after)).toEqual({
      a: { k1: 'x', k2: 'y' },
    });
  });

  it('drops a key genuinely absent from after (a real POEditor term deletion)', () => {
    const before = { a: { k1: 'x', k2: 'y' } };
    const after = { a: { k1: 'x' } };

    expect(mergeTranslations(before, after)).toEqual({ a: { k1: 'x' } });
  });

  it('recurses into nested namespace objects rather than replacing them wholesale', () => {
    const before = {
      a: { nested: { k1: '既存1', k2: '既存2' } },
    };
    const after = {
      a: { nested: { k1: '新規1', k2: '' } },
    };

    expect(mergeTranslations(before, after)).toEqual({
      a: { nested: { k1: '新規1', k2: '既存2' } },
    });
  });

  it('omits a brand-new nested object whose every leaf is empty, rather than writing an empty group', () => {
    const before = { k1: 'existing' };
    const after = { k1: 'existing', grp: { a: '', b: '' } };

    expect(mergeTranslations(before, after)).toEqual({ k1: 'existing' });
  });

  it('keeps a nested object that already existed in before, even if every leaf merges to empty', () => {
    const before = { grp: { a: 'existing' } };
    const after = { grp: { a: '' } };

    expect(mergeTranslations(before, after)).toEqual({
      grp: { a: 'existing' },
    });
  });

  it('matches the raw export when nothing is empty (no behavior change for the fully-translated case)', () => {
    const before = { a: { k1: 'old' } };
    const after = { a: { k1: 'new', k2: 'added' } };

    expect(mergeTranslations(before, after)).toEqual(after);
  });
});
