/**
 * i18n-reconcile.spec.ts
 *
 * Verifies that all required i18n locale keys for growi-vault reconcile
 * exist in both en_US and ja_JP locale files, with non-empty string values.
 *
 * Required keys (task 1.4):
 *   - growi-vault.reconcile.rejected.invalid-target
 *   - growi-vault.reconcile.rejected.bootstrap-not-done
 *   - growi-vault.reconcile.rejected.page-count-exceeds-user-limit
 *   - growi-vault.reconcile.rejected.page-count-exceeds-admin-limit
 *   - growi-vault.reconcile.rejected.user-concurrency-limit
 *   - growi-vault.reconcile.rejected.system-concurrency-limit
 *   - growi-vault.reconcile.accepted.message
 *   - growi-vault.reconcile.section.title
 *
 * Requirements: 6.3, 6.4, 6.8
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: resolve a dot-path key in a nested JSON object
// e.g. "growi-vault.reconcile.rejected.invalid-target" →
//      obj["growi-vault"]["reconcile"]["rejected"]["invalid-target"]
// ─────────────────────────────────────────────────────────────────────────────
function getNestedValue(
  obj: Record<string, unknown>,
  dotPath: string,
): unknown {
  return dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

// ─────────────────────────────────────────────────────────────────────────────
// Load locale files
// ─────────────────────────────────────────────────────────────────────────────
const LOCALE_BASE = join(__dirname, '../../../../public/static/locales');

function loadLocale(locale: string, file: string): Record<string, unknown> {
  const filePath = join(LOCALE_BASE, locale, file);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

const enAdmin = loadLocale('en_US', 'admin.json');
const jaAdmin = loadLocale('ja_JP', 'admin.json');

// ─────────────────────────────────────────────────────────────────────────────
// Required keys for growi-vault reconcile (task 1.4)
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_KEYS = [
  // Reject reason keys (Requirements 6.3, 6.4, 6.8)
  'growi-vault.reconcile.rejected.invalid-target',
  'growi-vault.reconcile.rejected.bootstrap-not-done',
  'growi-vault.reconcile.rejected.page-count-exceeds-user-limit',
  'growi-vault.reconcile.rejected.page-count-exceeds-admin-limit',
  'growi-vault.reconcile.rejected.user-concurrency-limit',
  'growi-vault.reconcile.rejected.system-concurrency-limit',
  // Submit feedback / admin UI keys
  'growi-vault.reconcile.accepted.message',
  'growi-vault.reconcile.section.title',
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('growi-vault reconcile i18n keys', () => {
  describe('en_US/admin.json', () => {
    for (const key of REQUIRED_KEYS) {
      it(`has non-empty string for key: ${key}`, () => {
        const value = getNestedValue(enAdmin, key);
        expect(
          value,
          `key "${key}" not found or empty in en_US/admin.json`,
        ).toBeTypeOf('string');
        expect(
          (value as string).trim().length,
          `key "${key}" is an empty string in en_US/admin.json`,
        ).toBeGreaterThan(0);
      });
    }
  });

  describe('ja_JP/admin.json', () => {
    for (const key of REQUIRED_KEYS) {
      it(`has non-empty string for key: ${key}`, () => {
        const value = getNestedValue(jaAdmin, key);
        expect(
          value,
          `key "${key}" not found or empty in ja_JP/admin.json`,
        ).toBeTypeOf('string');
        expect(
          (value as string).trim().length,
          `key "${key}" is an empty string in ja_JP/admin.json`,
        ).toBeGreaterThan(0);
      });
    }
  });
});
