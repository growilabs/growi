import { classify } from './diff-classifier';

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
});
