import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ACHIEVEMENT_LABEL_KEY,
  OPERATION_REASON_LABEL_KEYS,
  OPERATION_STATUS_LABEL_KEYS,
  OPERATION_TYPE_LABEL_KEYS,
  PROPOSAL_LIFECYCLE_LABEL_KEYS,
  PROPOSAL_LINK_LABEL_KEYS,
  PROPOSAL_STATUS_LABEL_KEYS,
  REVERT_REFUSAL_REASON_LABEL_KEYS,
} from './label-keys';

const LOCALES = ['en_US', 'ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'] as const;

const TABLES = {
  'change_proposal.operation_type': OPERATION_TYPE_LABEL_KEYS,
  'change_proposal.operation_status': OPERATION_STATUS_LABEL_KEYS,
  'change_proposal.proposal_status': PROPOSAL_STATUS_LABEL_KEYS,
  'change_proposal.reason': OPERATION_REASON_LABEL_KEYS,
  'change_proposal.revert_refusal_reason': REVERT_REFUSAL_REASON_LABEL_KEYS,
  'change_proposal.lifecycle': PROPOSAL_LIFECYCLE_LABEL_KEYS,
  'change_proposal.link': PROPOSAL_LINK_LABEL_KEYS,
} as const;

const readTranslation = (locale: string): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        `../../../../../public/static/locales/${locale}/translation.json`,
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

describe('label key tables', () => {
  it.each(
    Object.entries(TABLES),
  )('%s.* maps every value to prefix + value with "-" replaced by "_"', (prefix, table) => {
    const entries = Object.entries(table);
    expect(entries.length).toBeGreaterThan(0);
    for (const [value, key] of entries) {
      expect(key).toBe(`${prefix}.${value.replaceAll('-', '_')}`);
    }
  });

  it('the revert-refusal table covers every refusal reason that the reason table covers', () => {
    for (const reason of Object.keys(REVERT_REFUSAL_REASON_LABEL_KEYS)) {
      expect(OPERATION_REASON_LABEL_KEYS).toHaveProperty(reason);
    }
  });

  it('the achievement key is the settled-with-percent key', () => {
    expect(ACHIEVEMENT_LABEL_KEY).toBe(
      'change_proposal.achievement.settled_with_percent',
    );
  });
});

describe.each(LOCALES)('%s translation.json', (locale) => {
  const translation = readTranslation(locale);
  const english = readTranslation('en_US');

  const allKeys = [
    ...Object.values(TABLES).flatMap((table) => Object.values(table)),
    ACHIEVEMENT_LABEL_KEY,
  ];

  it.each(allKeys)('%s resolves to a non-empty string', (key) => {
    const value = resolveKey(translation, key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('the achievement text carries the {{percent}} placeholder', () => {
    expect(resolveKey(translation, ACHIEVEMENT_LABEL_KEY)).toContain(
      '{{percent}}',
    );
  });

  if (locale !== 'en_US') {
    it.each(allKeys)('%s is translated, not an English copy', (key) => {
      expect(resolveKey(translation, key)).not.toBe(resolveKey(english, key));
    });
  }
});
