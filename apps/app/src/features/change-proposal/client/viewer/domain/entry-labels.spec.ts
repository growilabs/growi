import * as fs from 'node:fs';
import * as path from 'node:path';

import i18nextConfig from '../../../../../../i18next.config';
import type { ProposalEntry } from '../../../interfaces';
import { ENTRY_LABEL_KEYS } from './entry-labels';

const LOCALES = ['en_US', 'ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'] as const;

const ALL_ENTRIES = [
  'ai-chat',
  'vault',
  'mcp',
  'revert',
] as const satisfies readonly ProposalEntry[];

const readTranslation = (locale: string): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        `../../../../../../public/static/locales/${locale}/translation.json`,
      ),
      'utf-8',
    ),
  ) as Record<string, unknown>;

const resolveKey = (
  translation: Record<string, unknown>,
  key: string,
): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        node != null && typeof node === 'object'
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      translation,
    );

describe('ENTRY_LABEL_KEYS', () => {
  it('has exactly one key per ProposalEntry value', () => {
    expectTypeOf<
      keyof typeof ENTRY_LABEL_KEYS
    >().toEqualTypeOf<ProposalEntry>();
    expect(Object.keys(ENTRY_LABEL_KEYS).sort()).toEqual(
      [...ALL_ENTRIES].sort(),
    );
  });

  it.each(
    ALL_ENTRIES,
  )('maps %s to a change_proposal_viewer.entry.* key', (entry) => {
    expect(ENTRY_LABEL_KEYS[entry]).toBe(
      `change_proposal_viewer.entry.${entry.replaceAll('-', '_')}`,
    );
  });

  it.each(
    Object.values(ENTRY_LABEL_KEYS),
  )('%s is listed one by one in extract.preservePatterns', (key) => {
    const patterns = i18nextConfig.extract?.preservePatterns ?? [];
    expect(patterns).toContain(key);
  });

  describe.each(LOCALES)('%s translation.json', (locale) => {
    const translation = readTranslation(locale);

    it.each(
      Object.values(ENTRY_LABEL_KEYS),
    )('%s resolves to a non-empty string', (key) => {
      const value = resolveKey(translation, key);
      expect(typeof value).toBe('string');
      expect((value as string).trim().length).toBeGreaterThan(0);
    });
  });
});
