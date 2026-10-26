import { describe, expect, it } from 'vitest';

import { CALLOUT_VARIANTS } from './callout-variants.js';
import { STATIC_EXTENDED_COMMANDS } from './static-commands.js';

describe('STATIC_EXTENDED_COMMANDS', () => {
  const byId = new Map(STATIC_EXTENDED_COMMANDS.map((c) => [c.id, c]));

  it('provides plantuml + lsx + one command per distinct callout variant', () => {
    expect(STATIC_EXTENDED_COMMANDS).toHaveLength(2 + CALLOUT_VARIANTS.length);
    expect(byId.has('plantuml')).toBe(true);
    expect(byId.has('lsx')).toBe(true);
    for (const v of CALLOUT_VARIANTS) {
      expect(byId.has(`callout-${v.type}`)).toBe(true);
    }
  });

  it('offers only the 5 visually-distinct callout types (info/danger are aliases, not commands)', () => {
    expect(CALLOUT_VARIANTS.map((v) => v.type)).toEqual([
      'note',
      'tip',
      'important',
      'warning',
      'caution',
    ]);
    // info renders as important and danger as caution, so no separate commands
    expect(byId.has('callout-info')).toBe(false);
    expect(byId.has('callout-danger')).toBe(false);
  });

  it('does not offer unselected elements (math / mermaid / image)', () => {
    for (const forbidden of ['math', 'katex', 'mermaid', 'image']) {
      expect(byId.has(forbidden)).toBe(false);
      expect(
        STATIC_EXTENDED_COMMANDS.some((c) => c.keywords.includes(forbidden)),
      ).toBe(false);
    }
  });

  it('is an insert command in every case', () => {
    for (const c of STATIC_EXTENDED_COMMANDS) {
      expect(c.action.kind).toBe('insert');
    }
  });

  it('excludes block-level commands (plantuml/callout) from list/table, but not inline lsx', () => {
    expect(byId.get('plantuml')?.disallowedIn).toEqual(['list', 'table']);
    for (const v of CALLOUT_VARIANTS) {
      expect(byId.get(`callout-${v.type}`)?.disallowedIn).toEqual([
        'list',
        'table',
      ]);
    }
    // lsx is an inline directive → no disallowedIn (offered everywhere)
    expect(byId.get('lsx')?.disallowedIn).toBeUndefined();
  });

  it('plantuml carries its i18n keys and uml keywords', () => {
    const plantuml = byId.get('plantuml');
    expect(plantuml?.labelKey).toBe('slash_command.plantuml.label');
    expect(plantuml?.descriptionKey).toBe('slash_command.plantuml.description');
    expect(plantuml?.keywords).toEqual(
      expect.arrayContaining(['uml', 'sequence']),
    );
  });

  it('lsx carries its i18n keys and is reachable via /ls and /lsx', () => {
    const lsx = byId.get('lsx');
    expect(lsx?.action.kind).toBe('insert');
    expect(lsx?.labelKey).toBe('slash_command.lsx.label');
    expect(lsx?.descriptionKey).toBe('slash_command.lsx.description');
    expect(lsx?.id).toBe('lsx');
    expect(lsx?.keywords).toEqual(
      expect.arrayContaining(['ls', 'list', 'pages', 'tree']),
    );
  });

  it('each callout command shares the "callout" keyword and per-type i18n keys', () => {
    for (const v of CALLOUT_VARIANTS) {
      const cmd = byId.get(`callout-${v.type}`);
      expect(cmd?.keywords).toContain('callout');
      expect(cmd?.keywords).toContain(v.type);
      expect(cmd?.labelKey).toBe(`slash_command.callout.${v.type}.label`);
      expect(cmd?.descriptionKey).toBe(
        `slash_command.callout.${v.type}.description`,
      );
    }
  });

  it('reaches aliased types via their directive names: warn→warning, info→important, danger→caution', () => {
    expect(byId.get('callout-warning')?.keywords).toContain('warn');
    // `info` renders as important, so it filters to the important command
    expect(byId.get('callout-important')?.keywords).toContain('info');
    // `danger` renders as caution, so it filters to the caution command
    expect(byId.get('callout-caution')?.keywords).toContain('danger');
  });
});
