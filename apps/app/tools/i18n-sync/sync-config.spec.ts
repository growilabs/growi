import * as fs from 'node:fs';
import * as path from 'node:path';

import { SHARED_POEDITOR_PROJECT_ID, SYNC_TARGETS } from './sync-config';

// Resolve locale files relative to this spec file (apps/app/tools/i18n-sync/)
// rather than process.cwd(), so the test is stable regardless of the
// directory vitest is invoked from.
const APP_ROOT = path.join(import.meta.dirname, '../..');

describe('SYNC_TARGETS', () => {
  it('declares exactly 3 entries', () => {
    expect(SYNC_TARGETS).toHaveLength(3);
  });

  it('declares the admin, translation, and commons namespaces (matching the 3 real locale file names)', () => {
    const namespaces = SYNC_TARGETS.map((entry) => entry.namespace).sort();
    expect(namespaces).toEqual(['admin', 'commons', 'translation']);
  });

  it('includes the translation namespace, whose file also carries packages/editor toolbar.* keys', () => {
    const translationEntry = SYNC_TARGETS.find(
      (entry) => entry.namespace === 'translation',
    );
    expect(translationEntry).toBeDefined();
  });

  it('resolves each namespace to an en_US locale file that actually exists on disk', () => {
    for (const entry of SYNC_TARGETS) {
      // localeFilePath is documented as relative to the apps/app root
      // (e.g. "public/static/locales/en_US/admin.json").
      const resolvedPath = entry.localeFilePath('en_US');
      const candidatePath = path.join(APP_ROOT, resolvedPath);

      expect(fs.existsSync(candidatePath)).toBe(true);
      expect(path.basename(candidatePath)).toBe(`${entry.namespace}.json`);
    }
  });

  it('declares a single non-empty shared POEditor project ID placeholder', () => {
    expect(SHARED_POEDITOR_PROJECT_ID.length).toBeGreaterThan(0);
  });

  it('does not carry a per-namespace poeditorProjectId field on any entry', () => {
    for (const entry of SYNC_TARGETS) {
      expect(entry).not.toHaveProperty('poeditorProjectId');
    }
  });
});
